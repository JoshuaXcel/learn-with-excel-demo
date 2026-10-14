const M=require((require("fs").existsSync(__dirname+"/../site")?"../site":"..")+"/js/minipy.js");const cp=require("child_process");const cases=require("./minipy_cases.json");
let bad=0,uns=0;for(const c of cases){const r=M.run(c);if(r.unsupported){uns++;console.log("UNSUPPORTED",JSON.stringify(c),r.why);continue;}
const p=cp.spawnSync(process.env.PY||"python3",["-c",c],{encoding:"utf8"});const perr=((p.stderr||"").trim().split("\n").pop()||"");
const merr=r.error?r.error.type+": "+r.error.msg:"";if(p.stdout!==r.display||perr!==merr){bad++;console.log("MISMATCH",JSON.stringify(c),"\n  py:",JSON.stringify(p.stdout),perr,"\n  mini:",JSON.stringify(r.display),merr);}}
console.log(`${cases.length} cases, ${bad} mismatches, ${uns} unsupported (fall back to Pyodide)`);process.exit(bad?1:0);