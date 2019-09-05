// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// constants
const assert = require('./assert.js');
const sk = require('./shapes/constants.js');

/**
 * Try to infer twosidedness requirements
 * 
 * @param src the source node to infer from
 * @param what the interface or course to infer sidedness for
 * @return whether twosidedness is required
 */
function inferSidedness(node, what){
  assert(node, 'Sidedness of empty source');
  if(!node)
    return false;
  // single-argument form
  if(what === undefined){
    assert('path' in node && 'node' in node, 'Invalid arguments');
    what = node.path;
    node = node.node;
  }

  // inference setting
  let defValue = null;
  let itfs = [];

  // closed interface case
  if(typeof what == 'string'){
    let itf0 = node.getInterface(what);
    if(itf0 && itf0.state == sk.CLOSED){
      return false; // XXX is it really single-sided? maybe different types of closure?
    }
  }

  // first pass
  switch(node.category){

    // sheets vs tubes vs tubes with closed ends
    case sk.NODE_SHEET:
      // flat => always single-sided
      if(node.type == sk.FLAT)
        return false; // single-sided
      else if(node.type == sk.CYLINDER){
        // cylinder => two-sided inside
        //             interfaces vary on state
        if(what == 'top' || what == 'bottom') {
          // OPEN = two-sided
          // CLOSED = single-sided
          // CONNECTED = two-sided
          return node.getInterface(what).state != sk.CLOSED;
        } else
          return true; // internal course => twosided
      } else {
        // auto => infer from other sides
        defValue = false;
        itfs = node.getInterfaces();
      }
      break;

    // custom => similar to sheet, but must evaluate to know value
    case sk.NODE_CUSTOM: {
      // else evaluate shape and use course information
      const { courses } = node.eval();
      const crs = what == 'top' ? courses[courses.length - 1] : courses[0];
      return crs.isTwoSided();
    }

    // connected joints propagate the requirement
    case sk.NODE_JOINT:
      defValue = true; // default to two-sided
      itfs = node.getInterfaces();
      break;

    // connected splits can infer from folded state
    // or propagate through base
    case sk.NODE_SPLIT:
      defValue = true; // node.folded;
      if(what == 'continuity')
        what = 'base'; // continuity has same requirement as base
      if(what != 'base'){
        if(!node.folded)
          return false; // that branch course is flat (because non-folded)
        // else the default is inferred from the base
        defValue = inferSidedness(node, 'base');
      }
      itfs = [node.getInterface(what)];
      break;
  }

  // actual inference needed
  let nodeMap = { [node.id]: true };
  while(itfs.length){
    let itf = itfs.shift();
    let side = itf.sides.find(side => side && !(side.node.id in nodeMap));
    if(!side)
      continue; // nothing we can infer from this interface

    // register node (to avoid passing through it again)
    nodeMap[side.node.id] = true;

    // case-by-case decision
    switch(side.node.category){

      // sheet => either use type or infer further
      case sk.NODE_SHEET:
        if(side.node.type == sk.FLAT)
          return false; // defines flat knitting
        if(side.node.type == sk.CYLINDER)
          return true;  // defines tubular knitting
        assert(side.node.type == sk.AUTO, 'Invalid sheet type ' + side.node.type);
        break;

      // custom => use direct inference for that node
      case sk.NODE_CUSTOM:
        return inferSidedness(side.node, side.path);

        // joint => infer further

        /* falls through */
      case sk.NODE_JOINT:
        // infer through next interface
        let other = side.node.getInterfaces().find(sitf => {
          let otherSide = sitf.otherSide(side.node);
          return otherSide && !(otherSide.node.id in nodeMap);
        });
        if(other)
          itfs.push(other);
        break;

      case sk.NODE_SPLIT:
        if(side.path == 'base'){
          if(side.node.folded){
            // infer from branches
            defValue = true;
            itfs.push(...side.node.branches.slice());
          }
        } else {
          if(side.node.folded){
            // infer from base
            defValue = true;
            itfs.push(side.node.base);
          }
          // else we cannot infer much from the split?
        }
        break;
    }
  }

  // no clear value => use default from initial node
  return defValue;
}

/**
 * Wasteful size inference for all reachable interfaces
 *
 * @param startNode the initial node to infer from
 * @param startPath the name of the initial interface to infer from
 * @return { [itf.id]: inferredWidth ... } where itf is reacheable
 */
function inferAllSizes(startNode, startPath){
  const sizes = {};
  const undefSizes = {};
  const minSizes = {};
  const known = {};
  const pass  = {};
  const getPass = () => {
    // console.log('pass', sizes, undefSizes, minSizes, known, pass);
    return Object.keys(sizes).length
         + Object.keys(undefSizes).length
         + Object.keys(minSizes).length
         + Object.keys(known).length
         + Object.keys(pass).length;
  };

  // knowledge aggregation
  const queue = [ { node: startNode, path: startPath } ];
  const itfs = {};
  const enqueue = (side) => {
    queue.push(side);
    // register interface for exploration
    const { node, path } = side;
    const itf = node.getInterface(path);
    itfs[itf.id] = itf;
  };
  while(queue.length){
    const { node, path } = queue.shift();
    const itf = node.getInterface(path);
    if(!itf){
      assert.error('Unsupported interface name:', path);
      continue;
    }

    // skip inference if the size is known
    if(known[itf.id])
      continue;

    // we need to infer something
    // => do breadth first search
    // = schedule pass to other side of interface if connected
    if(itf.isConnected()){
      enqueue(itf.otherSide(node));
    }
    // = schedule a pass to each of its interfaces again
    // note: reschedules itself too
    for(let newItf of node.getInterfaces()){
      if(newItf.isConnected())
        enqueue(newItf.otherSide(node));
      enqueue(newItf.thisSide(node));
    }

    // process known information
    // console.log(itf.id, 'of', node.category);
    switch(node.category){

      case sk.NODE_SHEET:
        if(path == 'bottom'){
          sizes[itf.id] = node.width.eval(0);
        } else {
          assert(path == 'top', 'Invalid path');
          sizes[itf.id] = node.width.eval(1);
        }
        known[itf.id] = true;
        break;

      case sk.NODE_CUSTOM: {
        let shape = node.eval();
        if(path == 'bottom')
          sizes[itf.id] = shape.first().width;
        else {
          assert(path == 'top', 'Invalid path');
          sizes[itf.id] = shape.last().width;
        }
        known[itf.id] = true;
      } break;

      case sk.NODE_JOINT: {
        minSizes[itf.id] = Math.max(minSizes[itf.id] || 2, node.width.max());
        // check other side
        const otherItf = node.getInterface(path == 'top' ? 'bottom' : 'top');
        if(known[otherItf.id]){
          const otherSize = sizes[otherItf.id];
          if(!itf.isConnected()){
            // directly use other
            sizes[itf.id] = otherSize;
            known[itf.id] = true;
          } else {
            // only get minimum size
            minSizes[itf.id] = Math.max(minSizes[itf.id] || 2, otherSize);
            undefSizes[itf.id] = true;
          }
        }
      } break;

      case sk.NODE_SPLIT:
        if(path == 'base'){
          // = base case
          // width is at least the maximum branch width
          for(let braItf of node.branches){
            if(known[braItf.id]){
              minSizes[itf.id] = Math.max(minSizes[itf.id] || 2, sizes[braItf.id]);
            } else {
              minSizes[itf.id] = Math.max(minSizes[itf.id] || 2, minSizes[braItf.id] || 2);
            }
          }
          // try inferring from branch's sum
          if(node.folded || !inferSidedness(node, 'base')){
            // width is the same as sum of branches
            if(node.branches.every(braItf => known[braItf.id])){
              // exact value
              sizes[itf.id] = node.branches.reduce((sum, braItf) => sum + sizes[braItf.id], 0);
              known[itf.id] = true;
            } else {
              // minimum value
              minSizes[itf.id] = Math.max(
                minSizes[itf.id] || 2,
                node.branches.reduce((sum, braItf) => sum + (minSizes[braItf.id] || 2), 0)
              );
              undefSizes[itf.id] = true;
            }
          } else {
            // width is at least half of the sum of branches
            if(node.branches.every(braItf => known[braItf.id])){
              // approximate value (may not match exactly)
              sizes[itf.id] = Math.ceil(node.branches.reduce((sum, braItf) => sum + sizes[braItf.id], 0) / 2);
              known[itf.id] = true;
            } else {
              // expected minimum value
              minSizes[itf.id] = Math.max(
                minSizes[itf.id] || 2,
                Math.ceil(node.branches.reduce((sum, braItf) => sum + (minSizes[braItf.id] || 2), 0) / 2)
              );
              undefSizes[itf.id] = true;
            }
          }

        } else {
          // = branch case
          // try inferring from base minus other branches
          if(known[node.base.id]){
            const doubleSize = !node.folded && inferSidedness(node, 'base');
            const baseSize = sizes[node.base.id] * (doubleSize ? 2 : 1);
            const knownSum = node.branches.reduce((sum, braItf) => {
              return known[braItf.id] ? sum + sizes[braItf.id] : sum;
            }, 0);
            const unknownMinSum = node.branches.reduce((sum, braItf) => {
              return known[braItf.id] ? sum : sum + (minSizes[braItf.id] || 2);
            }, 0);
            const knownCount = node.branches.reduce((sum, braItf) => {
              return known[braItf.id] ? sum + 1 : sum;
            }, 0);
            const unknownCount = node.degree - knownCount;

            // something doable since base is known
            if(knownCount == node.degree - 1){
              // direct value
              minSizes[itf.id] = Math.max(minSizes[itf.id] || 2, baseSize - knownSum);
            } else {
              // spread value delta
              // /!\ not the value, but the value delta!
              minSizes[itf.id] = (minSizes[itf.id] || 2) + Math.ceil((baseSize - knownSum - unknownMinSum) / unknownCount);
            }
            undefSizes[itf.id] = true;

          } else {
            // cannot do much here, we're missing both base and some branch
            minSizes[itf.id] = 2;
          }
        }
        break;

      default:
        assert.error('Unsupported node', node);
        break;
    }

    // infer minSizes for known ones
    if(known[itf.id])
      minSizes[itf.id] = sizes[itf.id];

    // must make sure we terminate eventually
    const thisPass = getPass();
    const lastPass = pass[itf.id] || 0;
    if(lastPass < thisPass){
      // something changed
      pass[itf.id] = thisPass;
    } else if(lastPass == thisPass){
      // nothing changed yet => allow one full pass
      pass[itf.id] = thisPass + 1;
    } else {
      // check that we have a minimum size for all known interfaces at least
      if(Object.keys(minSizes).length !== Object.keys(itfs).length)
        continue; // missing some interfaces
      else
        break; // one full pass happened without change
    }
  }

  // use minimum sizes for unknown values
  while(queue.length){
    const { node, path } = queue.pop();
    const itf = node.getInterface(path);
    if(itf.id in sizes)
      continue;
    else
      sizes[itf.id] = minSizes[itf.id] || 2;
  }
  // console.log('full', sizes);

  return sizes;
}

/**
 * Infer the width of a node's course
 *
 * @param node the source node for inference
 * @param what the course target name
 * @return the inferred size
 */
function inferSize(node, what){
  assert(node, 'Size of empty source');
  if(!node)
    return false;
  // single-argument form
  if(what === undefined){
    assert('path' in node && 'node' in node, 'Invalid arguments');
    what = node.path;
    node = node.node;
  }

  // get interface
  const itf = node.getInterface(what);
  assert(itf, 'Invalid interface', node, what);

  // if trivial solution, return it (faster)
  if(node.category == sk.NODE_SHEET){
    if(what == 'bottom')
      return node.width.eval(0);
    else if(what == 'top')
      return node.width.eval(1);
    else {
      assert.error('Unsupported interface:', what);
      return 2;
    }
  }

  // else, naively build knowledge graph
  const sizes = inferAllSizes(node, what);
  assert(itf.id in sizes, 'Inference failed for', node, what);
  return sizes[itf.id] || 2;
}


module.exports = {
  inferSidedness, inferSize
};
