#!/usr/bin/env python3
"""Plan or configure only FCM APIs and one existing runtime IAM binding.

Uses the installed Google Cloud CLI's normal authentication. It never reads
credential files, obtains access tokens, creates accounts, changes Firebase
Auth/PINs, links billing, deploys code, or sends messages. Run on the operator's
own computer or Google Cloud Shell; Firebase CLI login alone is not gcloud login.

  python3 scripts/configure-push.py
  python3 scripts/configure-push.py --apply --confirm wooriban-2027
"""

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys


PROJECT = "wooriban-2027"
BASE_ROLES = ("roles/datastore.user", "roles/firebaseauth.viewer")
FCM_ROLE = "roles/firebasecloudmessaging.admin"
APIS = ("fcm.googleapis.com", "fcmregistrations.googleapis.com")
SA_PATTERN = re.compile(
    r"[a-z][a-z0-9-]{4,28}[a-z0-9]@wooriban-2027\.iam\.gserviceaccount\.com"
)


class SetupError(Exception):
    """A setup prerequisite or explicit target check failed."""


def validate_service_account(email):
    if not isinstance(email, str) or not SA_PATTERN.fullmatch(email):
        raise SetupError("Use an existing service-account email in wooriban-2027.")
    return email


def select_service_account(policy, explicit=None):
    """Select existing, unconditional membership in BOTH runtime baseline roles."""
    if explicit is not None:
        validate_service_account(explicit)
    if not isinstance(policy, dict) or not isinstance(policy.get("bindings"), list):
        raise SetupError("The project IAM policy is missing a valid bindings list.")
    by_role = {role: set() for role in BASE_ROLES}
    for binding in policy["bindings"]:
        if not isinstance(binding, dict):
            raise SetupError("The project IAM policy contains an invalid binding.")
        role = binding.get("role")
        if not isinstance(role, str):
            raise SetupError("The project IAM policy contains an invalid role.")
        if role not in by_role:
            continue
        members = binding.get("members")
        if not isinstance(members, list) or any(not isinstance(m, str) for m in members):
            raise SetupError("A runtime role has an invalid IAM member list.")
        # Conditional membership is not evidence of unconditional runtime access.
        if binding.get("condition") is not None:
            continue
        for member in members:
            if member.startswith("serviceAccount:"):
                email = member[len("serviceAccount:") :]
                if SA_PATTERN.fullmatch(email):
                    by_role[role].add(email)
    candidates = set.intersection(*(by_role[role] for role in BASE_ROLES))
    if explicit is not None:
        if explicit not in candidates:
            raise SetupError("The selected account must already hold BOTH runtime baseline roles.")
        return explicit
    if len(candidates) != 1:
        raise SetupError(
            "Expected exactly one existing account with BOTH runtime baseline roles; "
            "use --service-account EMAIL to select a verified candidate."
        )
    return next(iter(candidates))


class Gcloud:
    def __init__(self, executable=None):
        self.executable = executable or shutil.which("gcloud")
        if not self.executable:
            raise SetupError("Google Cloud CLI is unavailable. Use Google Cloud Shell or install gcloud.")

    def run(self, args, json_output=False):
        command = [self.executable, *args]
        if json_output:
            command.append("--format=json")
        try:
            result = subprocess.run(
                command,
                shell=False,
                capture_output=True,
                text=True,
                check=False,
                timeout=180,
            )
        except FileNotFoundError as exc:
            raise SetupError("The gcloud executable is unavailable.") from exc
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise SetupError("The gcloud operation failed or timed out; no further commands were run.") from exc
        if result.returncode:
            # Never forward arbitrary CLI output, credential diagnostics, or tokens.
            raise SetupError("gcloud {} failed (exit {}).".format(" ".join(args[:2]), result.returncode))
        if json_output:
            try:
                return json.loads(result.stdout)
            except (TypeError, ValueError) as exc:
                raise SetupError("gcloud returned invalid JSON metadata.") from exc
        return None


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=PROJECT)
    parser.add_argument("--service-account", metavar="EMAIL")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm", metavar="PROJECT")
    args = parser.parse_args(argv)
    if args.project != PROJECT:
        raise SetupError("This script only supports project wooriban-2027.")
    if args.confirm is not None and args.confirm != PROJECT:
        raise SetupError("--confirm must be exactly wooriban-2027.")
    if args.apply and args.confirm != PROJECT:
        raise SetupError("Changes require --apply --confirm wooriban-2027.")
    if args.service_account is not None:
        validate_service_account(args.service_account)
    return args


def main(argv=None, runner=None):
    try:
        args = parse_args(argv)
        cli = runner if runner is not None else Gcloud()
        accounts = cli.run(["auth", "list", "--filter=status:ACTIVE"], json_output=True)
        if not isinstance(accounts, list) or len(accounts) != 1:
            raise SetupError("Select one active gcloud account; run gcloud auth login on your own computer.")
        account = accounts[0]
        if not isinstance(account, dict) or account.get("status") != "ACTIVE" or not isinstance(account.get("account"), str) or not account["account"]:
            raise SetupError("Select one active gcloud account; run gcloud auth login on your own computer.")
        policy = cli.run(["projects", "get-iam-policy", PROJECT], json_output=True)
        service_account = select_service_account(policy, args.service_account)
        info = cli.run(
            ["iam", "service-accounts", "describe", service_account, "--project", PROJECT],
            json_output=True,
        )
        if not isinstance(info, dict) or info.get("email") != service_account or info.get("projectId") != PROJECT:
            raise SetupError("The existing service-account metadata does not match the selected project and email.")
        if not isinstance(info.get("disabled", False), bool) or info.get("disabled", False):
            raise SetupError("The selected existing service account is disabled or has invalid metadata.")

        # All identity and explicit-target checks finish before either mutation.
        commands = [
            ["services", "enable", *APIS, "--project", PROJECT, "--format=none"],
            ["projects", "add-iam-policy-binding", PROJECT,
             "--member", "serviceAccount:" + service_account,
             "--role", FCM_ROLE, "--condition=None", "--format=none"],
        ]
        print(json.dumps({
            "mode": "apply" if args.apply else "plan",
            "project": PROJECT,
            "operator": account["account"],
            "serviceAccount": service_account,
            "existingRoles": list(BASE_ROLES),
            "addRole": FCM_ROLE,
            "enableApis": list(APIS),
        }, ensure_ascii=False))
        for command in commands:
            print("gcloud " + " ".join(shlex.quote(part) for part in command))
        if not args.apply:
            print("Plan only: read-only metadata checks completed; no changes were made.")
            return 0
        for command in commands:
            cli.run(command)
        print("FCM APIs and the single IAM binding were configured. No deployment or message was sent.")
        return 0
    except SetupError as exc:
        print("Setup stopped: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
