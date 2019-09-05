// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const sk = require('./skeleton.js');
const Timer = require('./timer.js');

function ShapeBlock(parent, shape, courses){
  this.parent = parent;
  this.shape = shape;
  if(courses === 'up'){
    this.courses = shape.courses.map((crs, i) => i);
  } else if(courses === 'down'){
    this.courses = shape.courses.map((crs, i) => shape.courses.length-1-i);
  } else {
    this.courses = courses;
  }
  this.yarn = { starting: !parent || parent.yarn.ending, ending: false, suspending: false };
}

function Schedule(shapes) {
  this.shapes = shapes || [];
  // create shape and interface maps
  this.shapeMap = {};
  this.itfMap = {};
  for(let s of shapes){
    this.shapeMap[s.node.id] = s;
    for(let itf of s.node.getInterfaces()){
      this.itfMap[itf.id] = itf;
    }
  }
  // the main content of the schedule
  this.blocks = [];
}
Schedule.prototype.addBlock = function(...args) {
  const block = new ShapeBlock(...args);
  this.blocks.push(block);
  return block;
};

/**
 * Trace yarn through the schedule and allocate
 * course connections as well as extra glue stitches
 *
 * Currently for single yarn carrier (should be extended for intarsia eventually)
 */
Schedule.prototype.trace = function(){
  const t = Timer.create();
  for(let block of this.blocks)
    block.shape.trace(block.courses, block.yarn);
  t.measure('trace');
  console.log('Yarn tracing', t.toString());
};

/**
 * Shape path identifier
 *
 * @param shape (or node) with id
 * @param path node interface name
 * @return identifier $id/$path
 */
function shapeSide(shape, path){
  return ('node' in shape ? shape.node.id : shape.id) + '/' + path;
}

/**
 * Check whether a source node reaches a target node through a given path forward
 *
 * @param the source node
 * @param path the interface path
 * @param trg the target node
 * @return whether the source reaches the target through that path eventually
 */
function pathReaches(src, path, trg){
  if(src.id === trg.id)
    return true;
  switch(src.category){
    case sk.NODE_SHEET:
    case sk.NODE_JOINT: 
    case sk.NODE_CUSTOM: {
      let other = path == 'top' ? 'bottom' : 'top';
      let itf = src[other];
      if(itf.isConnected()){
        let otherSide = itf.otherSide(src);
        return pathReaches(otherSide.node, otherSide.path, trg);
      }
    } break;

    case sk.NODE_SPLIT:
      if(path == 'base'){
        // reaches if any branches does
        return src.branches.some(itf => {
          if(itf.isConnected()){
            let otherSide = itf.otherSide(src);
            return pathReaches(otherSide.node, otherSide.path, trg);
          } else
            return false;
        });
      } else {
        // reaches if the base does
        if(src.base.isConnected()){
          let otherSide = src.base.otherSide(src);
          return pathReaches(otherSide.node, otherSide.path, trg);
        } else 
          return false;
      }
      break;
    default:
      break;
  }
  return false;
}

/**
 * Block iterator from array of blocks
 */
Schedule.prototype[Symbol.iterator] = function(){
  return this.blocks.values();
};

/**
 * Create a schedule from a list of shapes
 *
 * @param shapes the list of shapes
 * @return a schedule for traversing the shape list
 */
Schedule.create = function(shapes){
  let t = Timer.create();
  let schedule = new Schedule(shapes);

  // 1. Create topological order
  let queue = {
    forward: [], backward: []
  };
  let ordering = {
    forward: {}, // order
    backward: {} // order
  };
  let forwardPairs = {}; // shape, path
  // pushing stuff on the queue
  let enqueue = function(shape, path, order, backward){
    let direction = backward ? 'backward' : 'forward';
    queue[direction].push({ shape, path, order });
  };
  
  // add first shape
  enqueue(shapes[0], shapes[0].initial, 0);
  
  // process the queue
  while(queue.forward.length || queue.backward.length){
    let forward = queue.forward.length;
    let direction = forward ? 'forward' : 'backward';
    let { shape, path, order } = queue[direction].shift();
    let id = shapeSide(shape, path);
    if(id in ordering[direction]){
      let pastOrder = ordering[direction][id];
      if(pastOrder <= order){
        continue;
      }
    }
    if(forward){
      forwardPairs[id] = { shape, path };
    }
    if(Math.abs(order) > shapes.length){
      console.warning("Schedule found a dependency loop: this is not knittable!");
      return null;
    }
    // let revDir = forward ? 'backward' : 'forward';
    
    // save order information
    ordering[direction][id] = order;

    // order change direction
    let orderDelta = forward ? 1 : -1;

    // find next and previous interfaces to go through
    let next = [];
    let prev = [];
    switch(shape.node.category){
      case sk.NODE_SHEET:
      case sk.NODE_JOINT:
      case sk.NODE_CUSTOM: {
        let other = path == 'bottom' ? 'top' : 'bottom';
        next.push(shape.node[other]);
      } break;

      case sk.NODE_SPLIT:
        if(path == 'base'){
          for(let b of shape.node.branches)
            next.push(b);
        } else {
          next.push(shape.node.base);
          for(let b of shape.node.branches)
            prev.push(b);
        }
        break;

      default:
        throw "Unsupported scheduling of " + shape.node.category;
    }
    // propagate in the same direction
    for(let itf of next){
      if(itf.isConnected()){
        let otherSide = itf.otherSide(shape.node);
        let nextShape = schedule.shapeMap[otherSide.node.id];
        enqueue(nextShape, otherSide.path, order + orderDelta, !forward);
      } else if(!forward) {
        // reverse direction from here
        let thisSide = itf.thisSide(shape.node);
        enqueue(shape, thisSide.path, order, false);
      }
    }
    for(let itf of prev){
      if(itf.isConnected()){
        let otherSide = itf.otherSide(shape.node);
        let nextShape = schedule.shapeMap[otherSide.node.id];
        enqueue(nextShape, otherSide.path, order - orderDelta, forward); // reverse order
      }
    }
  }
  t.measure('topo');

  // 2. Create list of potential yarn starting points
  let shapeOrder = {};
  let starts = [];
  let minOrder = Infinity;
  for(let id in forwardPairs){
    let { shape, path } = forwardPairs[id];
    // store per-shape order information
    let order = ordering.forward[id];
    shapeOrder[shape.node.id] = order;
    // skip connected interfaces
    if(shape.node.getInterface(path).isConnected())
      continue;
    // the rest is a potential starting point
    starts.push({ shape, path, order });
    if(order < minOrder)
      minOrder = order;
  }
  starts.sort((a,b) => a.order - b.order);
  // XXX ordering has random scale (since a sequence of tubes increases order number)


  // generate blocks in a forward manner
  let seen = {};
  queue = []; // only forward queue
  queue.push({ shape: shapes[0], path: shapes[0].initial, parent: null });
  starts = starts.filter(({ shape }) => shape.node.id != shapes[0].node.id);

  // 3. Select starting block
  let initialID = shapeSide(shapes[0], shapes[0].initial);
  if(ordering.forward[initialID] != minOrder){
    // user-selected could be better
    console.log('[Warning] Other starting points have better topological order, e.g. ' + starts[0].shape.toString());
  }

  // 4. Go over queue, create blocks and add starting yarn points automatically
  do {
    while(queue.length){
      let { parent, shape, path } = queue.pop();
      let id = shape.node.id;
      if(seen[id])
        continue;
      else
        seen[id] = true;

      // get order rank
      assert(id in shapeOrder, 'Missing order for ' + id);
      let order = shapeOrder[id];

      switch(shape.node.category){
        case sk.NODE_SHEET:
        case sk.NODE_JOINT: 
        case sk.NODE_CUSTOM: {
          let block = schedule.addBlock(parent, shape, path == 'bottom' ? 'up' : 'down');
          let other = path == 'bottom' ? 'top' : 'bottom';
          let itf = shape.node[other];
          if(itf.isConnected()){
            let otherSide = itf.otherSide(shape.node);
            let nextShape = schedule.shapeMap[otherSide.node.id];
            queue.push({
              parent: block, shape: nextShape, path: otherSide.path
            });
          } else {
            // yarn is ending here
            block.yarn.ending = true;
          }
        } break;

        case sk.NODE_SPLIT: {
          // go over split interface (at least)
          let block = schedule.addBlock(parent, shape, [path]);
          
          // then depends on path
          if(path == 'base'){
            // we will be suspending yarn
            block.yarn.suspending = true;
            // first go over all disconnected branches
            let emptyBranches = shape.node.branches.filter(itf => !itf.isConnected());
            if(emptyBranches.length){
              // use first empty branch as end of split block
              block.courses.push('continuity', emptyBranches[0].thisSide(shape.node).path);
              block.yarn.ending = true; // and we cut there

              // then we go over each other empty branch first
              for(let b = 1; b < emptyBranches.length; ++b){
                let branch = emptyBranches[b];
                block = schedule.addBlock(block, shape, [branch.thisSide(shape.node).path]);
                // block.yarn.suspending = true;
                block.yarn.ending = true;
              }

              // then create new yarn starting points for connected branches
              for(let branch of shape.node.branches){
                if(branch.isConnected()){
                  let otherSide = branch.otherSide(shape.node);
                  let nextShape = schedule.shapeMap[otherSide.node.id];
                  starts.push({ shape: nextShape, path: otherSide.path, order: order + 1 });
                }
              }
            } else {
              // transfer yarn to first available branch
              // create new yarn starting sections for the rest
              let hasFirst = false;
              let hasSecond = false;
              for(let branch of shape.node.branches){
                if(branch.isConnected()){
                  let otherSide = branch.otherSide(shape.node);
                  let nextShape = schedule.shapeMap[otherSide.node.id];
                  if(!hasFirst){
                    hasFirst = true;
                    // must go over continuity course and corresponding branch
                    block.courses.push('continuity', branch.thisSide(shape.node).path);
                    // next block to go over is that branch
                    queue.push({
                      parent: block, shape: nextShape, path: otherSide.path
                    });
                  } else {
                    hasSecond = true;
                    // create new yarn starting point
                    starts.push({ shape: nextShape, path: otherSide.path, order: order + 1 });
                  }
                }
              }
              // if another branch to be taken => we have to suspend stitches
              if(hasSecond){
                block.yarn.suspending = true;
              }
            }

          } else {
            // /!\ coming from a branch side
            // we must ensure all other branches have been generated before generating this block
            // and the next one (base)
            let ready = true;
            for(let branch of shape.node.branches){
              if(branch.isConnected()){
                let otherSide = branch.otherSide(shape.node);
                if(otherSide.node.id in seen){
                  continue;
                } else {
                  ready = false;
                  let prevShape = schedule.shapeMap[otherSide.node.id];
                  let nextStart = starts.find(({ shape, path }) => {
                    return pathReaches(shape.node, path, prevShape.node);
                  });
                  if(!nextStart){
                    console.warning('Dependency cannot be satisfied');
                    return null;
                  }
                  // note: we provide a parent, but with suspended stitches
                  //       => will start yarn automatically
                  queue.push({ parent: block, shape: nextStart.shape, path: nextStart.path });
                  break;
                }
              }
            }

            // go over split block or postpone
            if(ready){
              // add continuity course and base to block
              block.courses.push('continuity', 'base');

              // if the base has something else, then go over that next
              if(shape.node.base.isConnected()){
                let otherSide = shape.node.base.otherSide(shape.node);
                let nextShape = schedule.shapeMap[otherSide.node.id];
                queue.push({ parent: block, shape: nextShape, path: otherSide.path });
              } else {
                // else this block was ending yarn
                block.yarn.ending = true;
              }
            } else {
              // otherwise, unmark this node (so that we can process it again)
              // when the next missing branch reaches it
              seen[id] = false;

              // block was ending
              block.yarn.ending = true;
              block.yarn.suspending = true; // this is important!
            }
          }
        } break;

        default:
          throw "Unsupported node type: " + shape.node.category;
      }
    }
    // last blocks should end the yarn
    schedule.blocks[schedule.blocks.length - 1].yarn.ending = true;
    
    // attempt starting again
    if(starts.length){
      starts.sort((a,b) => a.order - b.order);
      let { shape, path } = starts.shift();
      queue.push({ shape, path, parent: null });
    } else {
      // we're done with the schedule
      break;
    }
  } while(true);
  t.measure('opt');

  console.log('Scheduling', t.toString());

  // done
  return schedule;
};

module.exports = Schedule;
