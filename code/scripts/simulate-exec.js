const fs = require('fs')
const { parseWorkflow } = require('../shared/workflow-parser')
const { expandLoopTasks } = require('../plugins/workflow-host-preset/tools-preset')
const SF = 'C:/Users/ranwa/dsh_workspace/.workflow-agent/state.json'
async function main() {
  const items = ['login','order','payment','shipping','inventory','notify','audit','archive']
  const tasks = items.map((item,i) => ({ id:'module-review/'+item, name:'\u9010\u6A21\u5757\u8BC4\u5BA1 - '+item, type:'llm-task', status:'PENDING', _loopGroup:'module-review', _loopGroupName:'\u9010\u6A21\u5757\u8BC4\u5BA1', _loopItem:item, _loopIndex:i, _onError:'break', gateResult:null, processor:'dummy', gateChecker:null, gateOnFailure:null, retries:0 }))
  const all = [{ id:'req-analysis', name:'\u9700\u6C42\u5206\u6790', type:'llm-task', status:'PENDING', processor:'dummy', gateChecker:'dummy', gateResult:null, gateOnFailure:null, retries:0 }, ...tasks]
  function snap(ts,st,act,gr) { return { workflow:'demo-wf', version:'1.0', description:'Collapsed loop demo', params:{}, active:act, stage:st, tasks:ts.map(t=>({ id:t.id, name:t.name, type:t.type, status:t.status, processor:t.processor||null, gateChecker:t.gateChecker||null, gateResult:t.gateResult||null, gateOnFailure:t.gateOnFailure||null, retries:t.retries||0, _loopGroup:t._loopGroup||null, _loopGroupName:t._loopGroupName||null, _loopItem:t._loopItem||null, _loopIndex:t._loopIndex, _onError:t._onError||null })), gateResult:gr||null, retries:0, error:null, updatedAt:Date.now(), logs:[] } }
  function wr(s) { fs.writeFileSync(SF,JSON.stringify(s),'utf8') }
  function sl(m) { return new Promise(r=>setTimeout(r,m)) }
  console.log('=== Watch Workflow Tab ===\n')
  wr(snap(all,'PENDING',true)); console.log('START'); await sl(3000)
  const steps = [
    [0,'RUNNING'],[0,'DONE'],[1,'RUNNING'],[1,'DONE'],[2,'RUNNING'],[2,'DONE'],[3,'RUNNING'],[3,'DONE'],[4,'RUNNING'],[4,'DONE'],
    [5,'RUNNING'],[5,'FAILED'],
  ]
  for (const [idx,st] of steps) {
    all[idx].status = st
    if (st==='DONE') all[idx].gateResult = 'PASS'
    if (st==='FAILED' && all[idx]._onError==='break' && all[idx]._loopGroup) {
      all.forEach(t=>{ if(t._loopGroup===all[idx]._loopGroup && t.status==='PENDING') t.status='SKIPPED' })
    }
    wr(snap(all,'RUNNING',true))
    console.log(all.map(t=>t.id.split('/').pop()+'='+t.status).join(', '))
    await sl(st==='RUNNING'?2500:1500)
  }
  wr(snap(all,'COMPLETED',false,'FAIL'))
  console.log('\nDone: req-analysis flow + collapsed loop with fail+skip')
}
main().catch(e=>{console.error(e.message);process.exit(1)})
