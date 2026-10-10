import {it,expect} from "vitest";
import {dailyArticles} from "../src/recommendations";
import type {Article} from "../src/types";
const article=(id:string,source:string,published:string)=>({id,source,published,kind:"news"} as Article);
it("shows source variety with dates newest first and keeps old backfill in library",()=>{
 const items=[article("a","Wikinews","2026-10-10"),article("b","Wikinews","2026-10-09"),
 article("c","Wikinews","2026-10-08"),article("d","NIH","2026-10-07"),
 article("e","NSF","2026-10-06"),article("f","Global Voices","2026-10-05"),article("g","Other","2026-06-01")];
 expect(dailyArticles(items,Date.parse("2026-10-10T12:00:00Z")).map(a=>a.id)).toEqual(["a","d","e","f"]);
 expect(items).toHaveLength(7);
});
it("fills remaining slots when only one source is available",()=>{
 expect(dailyArticles([article("a","One","2026-10-10"),article("b","One","2026-10-09")],Date.parse("2026-10-10T12:00:00Z"))).toHaveLength(2);
});
