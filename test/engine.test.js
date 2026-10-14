const assert=require("assert");const Engine=require((require("fs").existsSync(__dirname+"/../site")?"../site":"..")+"/js/engine.js");
const H=3600e3;const it=(id,skill,d0)=>({id,skill,d0,modes:["adults","kids"]});
// 1. 8 correct answers in 40 seconds must NOT build long-term memory
let e=new Engine();const a=it("i1","s1",-1);let t=0;for(let k=0;k<8;k++)e.record(a,true,false,t+=5000);
assert.ok(e.halfLife("s1")<=1.01,"same-session repeats must not grow half-life: "+e.halfLife("s1"));
assert.ok(e.skill("s1").theta>0.5,"but theta should rise");
// spaced correct answers do grow it: 1, 3, 5 counted -> ~1, 3, 8 days
e=new Engine();t=0;const hs=[];for(let k=0;k<5;k++){e.record(a,true,false,t);hs.push(e.halfLife("s1"));t+=21*H;}
assert.ok(Math.abs(hs[0]-1)<0.15&&Math.abs(hs[2]-3)<0.6&&Math.abs(hs[4]-8)<1.5,"half-lives "+hs.map(x=>x.toFixed(2)));
// 2. hint: no item difficulty update, no mastery credit on a correct hinted answer
e=new Engine();const b=it("i2","s2",0);const r=e.record(b,true,true,0);
assert.strictEqual(e.itemD(b),0);assert.strictEqual(e.skill("s2").theta,0);assert.strictEqual(e.skill("s2").correct,0);assert.strictEqual(r.item_updated,false);
const r2=e.record(it("i3","s2",0),false,true,1000);assert.ok(e.skill("s2").theta<0,"hinted miss lowers theta");assert.strictEqual(e.itemD(it("i3","s2",0)),0);
// 3. new skill starts at the average of practised skills
e=new Engine();e.record(it("x","sA",0),true,false,0);e.record(it("y","sB",0),true,false,0);
const avg=(e.skill("sA").theta+e.skill("sB").theta)/2;assert.ok(Math.abs(e.skill("sNew").theta-avg)<1e-9);
// 4. every record carries engine_version and source
assert.strictEqual(r.source,"client");assert.ok(/^lwe-client-/.test(r.engine_version));
// pick: low theta -> easier candidate, high theta -> harder
e=new Engine();const easy=it("e","s9",-2),hard=it("h","s9",1);assert.strictEqual(e.pick([easy,hard],"adults").item.id,"e");
e.skill("s9").theta=3;assert.strictEqual(e.pick([easy,hard],"adults").item.id,"h");
console.log("engine tests passed; spaced half-lives:",hs.map(x=>x.toFixed(2)).join(", "),"days");