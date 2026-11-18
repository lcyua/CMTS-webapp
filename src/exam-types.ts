export type ExamTypeDefault={id:string;name:string;active:true;version:1};

/** Defaults for new classes and demos only. Existing saved catalogs are not migrated. */
export function defaultExamTypes():ExamTypeDefault[]{
 return [
  {id:'electrical-technician',name:'전기기능사',active:true,version:1},
  {id:'elevator-technician',name:'승강기기능사',active:true,version:1},
  {id:'facility-maintenance-technician',name:'설비보전기능사',active:true,version:1},
  {id:'electronic-device-technician',name:'전자기기기능사',active:true,version:1},
  {id:'automation-equipment-technician',name:'자동화설비기능사',active:true,version:1},
  {id:'welding-technician',name:'용접기능사',active:true,version:1},
  {id:'information-processing-technician',name:'정보처리기능사',active:true,version:1},
  {id:'renewable-energy-technician',name:'신재생에너지기능사',active:true,version:1}
 ];
}
