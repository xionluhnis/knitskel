// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const { Action, PassType } = require('../ir.js');
const Timer = require('../timer.js');

function BackwardFlow(pointers, misses){
  this.pointers = pointers || [];
  this.misses = misses || 0;
}
BackwardFlow.from = function(stitch, time){
  return new BackwardFlow([{ stitch, time }]);
};
BackwardFlow.copy = function(bf) {
  if(bf)
    return new BackwardFlow(bf.pointers.slice(), bf.misses);
  else
    return null;
};
BackwardFlow.prototype.miss = function(){
  this.misses += 1;
};
BackwardFlow.prototype.append = function(stitch, time){
  assert(!this.pointers.find(ptr => ptr.stitch == stitch),
    'Stitch appended twice');
  this.pointers.push({ stitch, time });
};
BackwardFlow.prototype.merge = function(flow){
  for(let i = 0; i < flow.pointers.length; ++i){
    let { stitch, time } = flow.pointers[i];
    this.append(stitch, time);
  }
  this.misses = Math.max(this.misses, flow.misses);
};

module.exports = {
  simulate: function(){
    let t = Timer.create();
    for(let t = 0; t < this.length; ++t){
      const curr = this.timeline[t];
      const next = curr.next(); // to allow last bed simulation

      // transfer current state
      next.state.front = curr.state.front.map(bf => BackwardFlow.copy(bf));
      next.state.back  = curr.state.back.map(bf => BackwardFlow.copy(bf));
      next.states = [ next.state.front, next.state.back ];

      // state update
      const remove = (index, side) => {
        next.states[side][index] = null;
      };
      const append = (index, side, stitch) => {
        if(next.states[side][index])
          next.states[side][index].append(stitch, t);
        else
          next.states[side][index] = BackwardFlow.from(stitch, t);
      };
      const miss = (index, side) => {
        if(next.states[side][index])
          next.states[side][index].miss();
      };
      const tuck = (index, side, stitch) => {
        if(next.states[side][index]){
          next.states[side][index].append(stitch, t);
          next.states[side][index].miss(); // collapsing one row
        } else
          next.states[side][index] = BackwardFlow.from(stitch, t);
      };
      const get = (index, side) => next.states[side][index];
      const merge = (index, side, flow) => {
        if(next.states[side][index])
          next.states[side][index].merge(flow);
        else
          next.states[side][index] = flow;
      };

      // apply passes
      for(let pass of curr.passes){
        if(pass.type == PassType.CAST_ON)
          continue;

        switch(pass.type){

          case PassType.CAST_ON:
          case PassType.CAST_OFF:
            continue;

          case PassType.ACTION:
            for(let stitch of pass.sequence){
              let { action, source, targets } = pass.actionMap[stitch.id];
              if(action == Action.MISS){
                miss(source.index, source.side);
                continue; // no flow change
              }
              // tuck => do not remove previous pointer
              // else => remove previous pointer (knit)
              if(action != Action.TUCK){
                let bf = get(source.index, source.side);
                if(bf){
                  // knit => check time collapse + #loops
                  if(bf.pointers.length > 3)
                    curr.warning(stitch, bf.pointers.length + ' loops to knit through', bf);
                  let minTime = bf.pointers[0].time;
                  assert(minTime <= t, 'Backward time travelling!');
                  // note: suspended stitches can come from far away in time
                  // thus conflicting ones are those that have been "missed"
                  if(bf.misses > 2)
                    curr.warning(stitch, 'Knit over ' + bf.misses + ' misses', bf);

                  // knit => remove previous loops
                  remove(source.index, source.side);
                }
                // knit => create new single loop
                append(source.index, source.side, stitch);
              } else {
                tuck(source.index, source.side, stitch);
              }
              // append back flow on secondary targets
              for(let i = 1; i < targets.length; ++i){
                let { index, side } = targets[i];
                // note: kickback has fake secondary target to itself
                // => secondary is not strictly related to index
                if(index == source.index && side == source.side)
                  continue; // fake secondary (or primary)
                // else => replace loop
                append(index, side, stitch);
              }
            }
            break;

          case PassType.TRANSFER:
            // combine flow information at once
            let backFlows = [];
            // 1 = remove all transferring flows at once
            for(let stitch of pass.sequence){
              let { source, targets } = pass.actionMap[stitch.id];
              assert(targets.length === 1, 'Transfer with no or multiple targets');
              backFlows.push(get(source.index, source.side));
              remove(source.index, source.side);
            }
            // 2 = merge all transferring flows at once
            for(let i = 0; i < backFlows.length; ++i){
              let stitch = pass.sequence[i];
              let { targets = [] } = pass.actionMap[stitch.id];
              let flow = backFlows[i];
              merge(targets[0].index || 0, targets[0].side || 0, flow);
            }
            break;

          default:
            console.log('Unsupported pass type', pass.type);
            break;
        }
      } // endfor pass

    } // endfor t
    t.measure('run');
    console.log('Simulation', t.toString());
  } // endfun simulate
};
