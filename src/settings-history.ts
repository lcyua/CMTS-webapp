import type {RecordData} from './domain';

/** History envelopes are transport metadata, never editable definition fields. */
export function cleanDefinition(row:RecordData):RecordData{
 const {archived,historyId,originalId,...definition}=row;
 return {...definition,id:typeof originalId==='string'?originalId:definition.id};
}

/** A stale history page must not replace a newer live or locally saved definition. */
export function mergeDefinitionRows(current:RecordData[],history:RecordData[]):RecordData[]{
 const rows=new Map<string,RecordData>();
 for(const raw of [...current,...history]){
  const row=cleanDefinition(raw);
  if(typeof row.id!=='string'||!row.id)continue;
  const previous=rows.get(row.id);
  if(!previous||(row.version??0)>(previous.version??0))rows.set(row.id,row);
 }
 return [...rows.values()];
}
