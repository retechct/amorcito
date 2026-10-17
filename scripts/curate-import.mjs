// Initial editorial selection only. Never replaces memories edited in the workshop.
import {readFile,writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
const selections={
 "IMG_0669.HEIC":"Dos cafés. Mil cosas que contarnos.",
 "IMG_0488.HEIC":"La suerte de ir de tu mano",
 "IMG_0484.HEIC":"El mundo se detiene un poquito",
 "IMG_0425.HEIC":"Tú, yo y las pequeñas aventuras",
 "IMG_0502.HEIC":"A tu lado, todo brilla"
};
const path=resolve(".private/import-catalog.json");
const catalog=JSON.parse(await readFile(path,"utf8"));
catalog.memories=catalog.memories.map(m=>selections[m.originalName]?{...m,title:selections[m.originalName],featured:true}:m);
await writeFile(path,JSON.stringify(catalog,null,2));
const db=new DatabaseSync(resolve(".private/archive.sqlite"));
const row=db.prepare("SELECT * FROM archive WHERE id=1").get();
if(row){
 const current=JSON.parse(row.payload);
 current.memories=current.memories.map(m=>m.updated===0 && selections[m.originalName]?{...m,title:selections[m.originalName],featured:true}:m);
 db.prepare("UPDATE archive SET payload=?,revision=revision+1 WHERE id=1").run(JSON.stringify(current));
}
db.close();
console.log("Selección inicial preparada; se conservaron los recuerdos ya editados.");
