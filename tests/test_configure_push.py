"""Offline checks for the local gcloud push setup helper; no subprocess may run live."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import subprocess
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "configure-push.py"
SPEC = importlib.util.spec_from_file_location("configure_push_under_test", SCRIPT)
assert SPEC and SPEC.loader
setup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup)

PROJECT = "wooriban-2027"
RUNTIME = f"runtime@{PROJECT}.iam.gserviceaccount.com"
SECOND = f"other-runtime@{PROJECT}.iam.gserviceaccount.com"
OTHER_PROJECT = "runtime@another-project.iam.gserviceaccount.com"
REQUIRED_ROLES = ("roles/datastore.user", "roles/firebaseauth.viewer")
FCM_ROLE = "roles/firebasecloudmessaging.admin"
APIS = {"fcm.googleapis.com", "fcmregistrations.googleapis.com"}


def policy_for(*accounts: str) -> dict:
    return {"bindings": [{"role": role, "members": ["serviceAccount:" + account for account in accounts]}
                         for role in REQUIRED_ROLES]}


class FakeRunner:
    """Explicit command responses; unknown commands fail instead of touching gcloud."""

    def __init__(self, *, policy=None, auth=None, description=None):
        self.calls = []
        self.policy = policy if policy is not None else policy_for(RUNTIME)
        self.auth = auth if auth is not None else [{"account": "operator@example.test", "status": "ACTIVE"}]
        self.description = description if description is not None else {
            "email": RUNTIME, "projectId": PROJECT, "disabled": False,
        }

    def run(self, args, json_output=False):
        args = list(args)
        self.calls.append((args, json_output))
        if args[:2] == ["auth", "list"]:
            return self.auth
        if args[:2] == ["projects", "get-iam-policy"]:
            return self.policy
        if args[:3] == ["iam", "service-accounts", "describe"]:
            return self.description
        if args[:2] in (["services", "enable"], ["projects", "add-iam-policy-binding"]):
            return None
        raise AssertionError("Unexpected command in offline test: " + repr(args))

    @property
    def mutations(self):
        return [args for args, _ in self.calls
                if args[:2] in (["services", "enable"], ["projects", "add-iam-policy-binding"])]


def main_result(argv, runner=None):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return setup.main(argv, runner=runner)


class ServiceAccountSelectionTests(unittest.TestCase):
    def test_unique_unconditional_role_intersection(self):
        policy = policy_for(RUNTIME)
        policy["bindings"].append({"role": "roles/editor", "members": ["serviceAccount:" + SECOND]})
        self.assertEqual(setup.select_service_account(policy), RUNTIME)

    def test_roles_on_different_accounts_do_not_form_a_runtime(self):
        policy = {"bindings": [
            {"role": REQUIRED_ROLES[0], "members": ["serviceAccount:" + RUNTIME]},
            {"role": REQUIRED_ROLES[1], "members": ["serviceAccount:" + SECOND]},
        ]}
        with self.assertRaises(setup.SetupError):
            setup.select_service_account(policy)

    def test_ambiguous_intersection_requires_verified_explicit_account(self):
        policy = policy_for(RUNTIME, SECOND)
        with self.assertRaises(setup.SetupError):
            setup.select_service_account(policy)
        self.assertEqual(setup.select_service_account(policy, explicit=SECOND), SECOND)

    def test_explicit_account_must_have_both_required_roles(self):
        with self.assertRaises(setup.SetupError):
            setup.select_service_account(policy_for(RUNTIME), explicit=SECOND)

    def test_cross_project_and_non_service_account_members_are_rejected(self):
        for member in ("serviceAccount:" + OTHER_PROJECT, "user:" + RUNTIME,
                       "serviceAccount:runtime@wooriban-2027.iam.gserviceaccount.com.evil.test"):
            with self.subTest(member=member):
                policy = {"bindings": [{"role": role, "members": [member]} for role in REQUIRED_ROLES]}
                with self.assertRaises(setup.SetupError):
                    setup.select_service_account(policy)

    def test_explicit_cross_project_account_is_rejected(self):
        with self.assertRaises(setup.SetupError):
            setup.select_service_account(policy_for(OTHER_PROJECT), explicit=OTHER_PROJECT)

    def test_conditional_bindings_do_not_authorize_setup(self):
        for binding_index in (0, 1):
            policy = policy_for(RUNTIME)
            policy["bindings"][binding_index]["condition"] = {"expression": "true", "title": "Conditional"}
            with self.subTest(binding_index=binding_index), self.assertRaises(setup.SetupError):
                setup.select_service_account(policy)

    def test_duplicate_members_do_not_make_one_account_ambiguous(self):
        policy = policy_for(RUNTIME, RUNTIME)
        self.assertEqual(setup.select_service_account(policy), RUNTIME)


class PlanAndApplyTests(unittest.TestCase):
    def test_fixed_project_and_apply_confirmation_are_checked_before_io(self):
        for argv in (["--project", "other-project"], ["--apply"],
                     ["--apply", "--confirm", "other-project"],
                     ["--service-account", OTHER_PROJECT]):
            with self.subTest(argv=argv):
                runner = FakeRunner()
                self.assertEqual(main_result(argv, runner), 1)
                self.assertEqual(runner.calls, [])

    def test_parse_args_rejects_invalid_project_with_setup_error(self):
        self.assertEqual(setup.PROJECT, PROJECT)
        with self.assertRaises(setup.SetupError):
            setup.parse_args(["--project", "another-project"])

    def test_default_plan_reads_only_and_never_extracts_tokens(self):
        runner = FakeRunner()
        self.assertEqual(main_result([], runner), 0)
        self.assertEqual(runner.mutations, [])
        self.assertEqual(len(runner.calls), 3)
        self.assertEqual(runner.calls[0][0][:2], ["auth", "list"])
        self.assertEqual(runner.calls[1][0][:2], ["projects", "get-iam-policy"])
        self.assertEqual(runner.calls[2][0][:3], ["iam", "service-accounts", "describe"])
        for args, _ in runner.calls:
            self.assertFalse(any("access-token" in arg or "refresh-token" in arg for arg in args))

    def test_no_active_auth_stops_before_policy_or_mutation(self):
        runner = FakeRunner(auth=[])
        self.assertEqual(main_result(["--apply", "--confirm", PROJECT], runner), 1)
        self.assertEqual(len(runner.calls), 1)
        self.assertEqual(runner.mutations, [])

    def test_ambiguous_runtime_stops_before_describe_or_mutations(self):
        runner = FakeRunner(policy=policy_for(RUNTIME, SECOND))
        self.assertEqual(main_result(["--apply", "--confirm", PROJECT], runner), 1)
        self.assertEqual(len(runner.calls), 2)
        self.assertEqual(runner.mutations, [])

    def test_apply_enables_only_two_fcm_apis_then_adds_only_fcm_role(self):
        runner = FakeRunner()
        self.assertEqual(main_result(["--apply", "--confirm", PROJECT], runner), 0)
        self.assertEqual(len(runner.calls), 5)
        enable, binding = runner.mutations
        self.assertEqual(enable[:2], ["services", "enable"])
        self.assertEqual(set(enable[2:enable.index("--project")]), APIS)
        self.assertEqual(enable[enable.index("--project") + 1], PROJECT)
        self.assertEqual(binding[:3], ["projects", "add-iam-policy-binding", PROJECT])
        self.assertEqual(binding[binding.index("--member") + 1], "serviceAccount:" + RUNTIME)
        self.assertEqual(binding[binding.index("--role") + 1], FCM_ROLE)
        self.assertIn("--condition=None", binding)
        self.assertEqual([json_output for _, json_output in runner.calls[-2:]], [False, False])
        self.assertFalse(any("billing" in arg.lower() for args, _ in runner.calls for arg in args))

    def test_apply_waits_for_exact_enabled_service_account_description(self):
        invalid_descriptions = [
            {"email": SECOND, "projectId": PROJECT, "disabled": False},
            {"email": RUNTIME, "projectId": "another-project", "disabled": False},
            {"email": RUNTIME, "projectId": PROJECT, "disabled": True},
            {"email": RUNTIME, "projectId": PROJECT, "disabled": "false"},
        ]
        for description in invalid_descriptions:
            with self.subTest(description=description):
                runner = FakeRunner(description=description)
                self.assertEqual(main_result(["--apply", "--confirm", PROJECT], runner), 1)
                self.assertEqual(runner.mutations, [])
                self.assertEqual(len(runner.calls), 3)

    def test_missing_gcloud_returns_error_without_starting_subprocess(self):
        with mock.patch.object(setup.shutil, "which", return_value=None), \
                mock.patch.object(setup.subprocess, "run") as run:
            self.assertEqual(main_result([]), 1)
            run.assert_not_called()

    def test_enable_failure_stops_before_any_iam_binding(self):
        class FailingRunner(FakeRunner):
            def run(self, args, json_output=False):
                result = super().run(args, json_output=json_output)
                if list(args)[:2] == ["services", "enable"]:
                    raise setup.SetupError("Synthetic enable failure")
                return result

        runner = FailingRunner()
        self.assertEqual(main_result(["--apply", "--confirm", PROJECT], runner), 1)
        self.assertEqual(len(runner.calls), 4)
        self.assertEqual(len(runner.mutations), 1)
        self.assertEqual(runner.mutations[0][:2], ["services", "enable"])

    def test_invalid_active_auth_metadata_never_reads_policy(self):
        invalid_accounts = [
            [{"account": "", "status": "ACTIVE"}],
            [{"account": "operator@example.test", "status": "INACTIVE"}],
            [{"account": "one@example.test", "status": "ACTIVE"},
             {"account": "two@example.test", "status": "ACTIVE"}],
            {"account": "operator@example.test", "status": "ACTIVE"},
        ]
        for accounts in invalid_accounts:
            with self.subTest(accounts=accounts):
                runner = FakeRunner(auth=accounts)
                self.assertEqual(main_result(["--apply", "--confirm", PROJECT], runner), 1)
                self.assertEqual(len(runner.calls), 1)
                self.assertEqual(runner.mutations, [])


class GcloudTransportTests(unittest.TestCase):
    def test_subprocess_uses_argument_list_and_shell_false(self):
        response = subprocess.CompletedProcess(args=[], returncode=0, stdout='[{"status":"ACTIVE"}]', stderr="")
        with mock.patch.object(setup.subprocess, "run", return_value=response) as run:
            client = setup.Gcloud(executable="gcloud-test")
            result = client.run(["auth", "list"], json_output=True)
        self.assertEqual(result, [{"status": "ACTIVE"}])
        args, kwargs = run.call_args
        self.assertIsInstance(args[0], list)
        self.assertEqual(args[0][0], "gcloud-test")
        self.assertEqual(args[0][1:3], ["auth", "list"])
        self.assertIs(kwargs.get("shell"), False)
        self.assertIs(kwargs.get("capture_output"), True)
        self.assertIs(kwargs.get("text"), True)
        self.assertIs(kwargs.get("check"), False)

    def test_failed_gcloud_is_a_setup_error(self):
        response = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="synthetic failure")
        with mock.patch.object(setup.subprocess, "run", return_value=response):
            with self.assertRaises(setup.SetupError):
                setup.Gcloud(executable="gcloud-test").run(["auth", "list"], json_output=True)

    def test_failed_gcloud_never_forwards_arbitrary_cli_diagnostics(self):
        response = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="synthetic-secret-value", stderr="synthetic-secret-value")
        with mock.patch.object(setup.subprocess, "run", return_value=response):
            with self.assertRaises(setup.SetupError) as caught:
                setup.Gcloud(executable="gcloud-test").run(["auth", "list"], json_output=True)
        self.assertNotIn("synthetic-secret-value", str(caught.exception))

    def test_timeout_and_invalid_json_fail_closed(self):
        with mock.patch.object(setup.subprocess, "run", side_effect=subprocess.TimeoutExpired("gcloud", 180)):
            with self.assertRaises(setup.SetupError):
                setup.Gcloud(executable="gcloud-test").run(["auth", "list"], json_output=True)
        response = subprocess.CompletedProcess(args=[], returncode=0, stdout="not-json", stderr="")
        with mock.patch.object(setup.subprocess, "run", return_value=response):
            with self.assertRaises(setup.SetupError):
                setup.Gcloud(executable="gcloud-test").run(["auth", "list"], json_output=True)


if __name__ == "__main__":
    unittest.main()
