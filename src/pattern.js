// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('./assert.js');
const DSL = require('./dsl.js');
const env = require('./env.js');
const Timer = require('./timer.js');
const noise = require('simplenoise');

const P = {
  // pattern instructions
  STITCH: 1,
  PURL:   2,
  TUCK:   3,
  MISS:   4,
  FRONT_RIGHT1: 5,
  FRONT_RIGHT2: 6,
  FRONT_LEFT1:  7,
  FRONT_LEFT2:  8,
  BACK_RIGHT1:  9,
  BACK_RIGHT2:  10,
  BACK_LEFT1:   11,
  BACK_LEFT2:   12,
  CROSS_RIGHT_UPPER:  13,
  CROSS_RIGHT_LOWER:  14,
  CROSS_LEFT_UPPER:   15,
  CROSS_LEFT_LOWER:   16,
  STACK:  17,

  // pattern groups
  REVERSE_PATTERNS: {
    2: true, 9: true, 10: true, 11: true, 12: true
  },
  MOVE_PATTERNS: {
    5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true
  },
  CROSS_PATTERNS: {
    13: true, 14: true, 15: true, 16: true
  },
  CROSS_ABOVE: {
    13: true, 15: true
  },
  CROSS_BELOW: {
    14: true, 16: true
  },

  // pattern directions
  DIRECTION_OF: {
    // move directions
    5: 1, 6: 1, 7: -1, 8: -1, 9: 1, 10: 1, 11: -1, 12: -1,
    // cross directions
    13: 1, 14: 1, 15: -1, 16: -1
  },
  // pattern steps
  STEPS_OF: {
    // move steps
    5: 1, 6: 2, 7: 1, 8: 2, 9: 1, 10: 2, 11: 1, 12: 2,
    // cable steps (assumed 1)
    13: 1, 14: 1, 15: 1, 16: 1
  },

  // cross complements
  CROSS_COMPLEMENT_OF: {
    13: 16, 14: 15, 15: 14, 16: 13
  },

  // move map
  MOVE: {
    'front': {
      'left': [ 7, 8 ],
      'right': [ 5, 6 ]
    },
    'back': {
      'left': [ 11, 12 ],
      'right': [ 9, 10 ]
    },
  },
  moveFor(...args){
    let side = null;
    let dir  = null;
    let steps = 0;
    for(let i = 0; i < args.length; ++i){
      if(typeof args[i] == 'number'){
        assert(args[i] && Math.abs(args[i]) <= 2, 'Move can only use steps 1 or 2');
        if(args[i] < 0){
          assert(!dir, 'Step sign conflicts with direction argument');
          dir = 'left';
          steps = -args[i];
        } else {
          steps = args[i];
        }
      } else {
        let arg = args[i].toLowerCase();
        switch(arg){
          case 'front':
          case 'back':
            assert(!side, 'Side argument conflict');
            side = arg;
            break;
          case 'left':
          case 'right':
            assert(!dir, 'Direction argument conflict');
            dir = arg;
            break;
          default:
            throw "Invalid argument " + arg;
        }
      }
    }
    // default arguments
    if(!side)
      side = 'front';
    if(!dir)
      dir = 'right';
    if(!steps)
      steps = 1;
    assert(side in P.MOVE, 'Invalid side');
    assert(dir in P.MOVE[side], 'Invalid direction');
    assert(steps == 1 || steps == 2, 'Invalid steps');
    return P.MOVE[side][dir][steps - 1];
  },

  // cross map
  CROSS: {
    'right': {
      // upper
      1: 13,
      '+': 13,
      'upper': 13,
      // lower
      0: 14,
      '-': 14,
      'lower': 14
    },
    'left': {
      // upper
      1: 15,
      '+': 15,
      'upper': 15,
      // lower
      0: 16,
      '-': 16,
      'lower': 16
    }
  },
  crossFor: function(...args){
    let dir = null;
    let order = null;
    for(let i = 0; i < args.length; ++i){
      let arg = args[i].toString().toLowerCase();
      if(arg in P.CROSS){
        assert(!dir, 'Direction argument conflict');
        dir = arg;
      } else if(arg in P.CROSS.right){
        assert(!order, 'Order argument conflict');
        order = arg;
      } else {
        throw 'Invalid argument ' + arg;
      }
    }
    if(!dir)
      dir = 'right';
    if(!order)
      order = 'upper';
    assert(dir in P.CROSS, 'Invalid direction');
    assert(order in P.CROSS[dir], 'Invalid order');
    return P.CROSS[dir][order];
  },

  // pattern modifiers
  SINGULAR: 0,
  SCALABLE: 1,
  TILEABLE: 2,

  // pass storage
  PASS_STORAGE: 'pattern'
};

/**
 * Pattern constructor
 */
function Pattern(context, stitches, indices, nodes, id2idx, passID){
  this.context = context;
  this.stitches = stitches; // reference
  this.indices = indices || stitches.map((s, i) => i);
  this.nodes = nodes || stitches.map((s, i) => wrap(s, context ? context.node : null, i));
  if(id2idx)
    this.id2idx = id2idx;
  else {
    // build mapping
    this.id2idx = {};
    for(let i = 0; i < stitches.length; ++i)
      this.id2idx[stitches[i].id] = i;
  }
  this.passID = passID !== undefined ? passID : -1;
}
/**
 * Run a function with this pattern as input, normalized to all stitches
 * with a specific pass id.
 *
 * @param passID the pass identifier to use for that function's pattern
 * @param func a function (pat) => {}
 */
Pattern.prototype.forPass = function(passID, func){
  const pat = this.all();
  pat.passID = passID;
  func(pat);
};
/**
 * Return the pattern node (wrapper over stitch) at a given index
 *
 * @param idx the index to query
 * @return the pattern wrapped stitch
 */
Pattern.prototype.node = function(idx){
  return this.nodes[idx || 0];
};
/**
 * Return a new pattern wrapping a single stitch
 *
 * @param sid the stitch id
 * @return the singleton pattern
 */
Pattern.prototype.stitchPattern = function(sid){
  const idx = this.id2idx[sid];
  return new Pattern(this.context, [this.stitches[idx]], [0], [this.nodes[idx]], null, this.passID);
};

/**
 * Create a sub-pattern selection using given indices
 *
 * @param indices the new indices
 */
Pattern.prototype.withIndices = function(indices){
  return new Pattern(this.context, this.stitches, indices, this.nodes, this.id2idx, this.passID);
};
/**
 * Converts a stitch primitive into a node
 * that can safely be handled in the pattern code.
 * This adds easy access to some properties.
 *
 * General properties include
 *
 * - id
 * - shapes
 * - anchors
 * - flat
 * - siblings (# of course connections)
 * - links (# of wale connections)
 *
 * whereas context-dependent ones include
 * 
 * - names
 * - courseId
 * - courseEnd
 * - waleId
 * - waleEnd
 * - gauge (1 for full, 2 for half gauge)
 *
 * @param stitch the new stitch
 * @param node the node context (or null if global)
 */
function wrap(stitch, node, index){
  let ctxData = {
    names: stitch.meta(node, 'names')
  };
  for(let what of ['courseId', 'courseEnd', 'waleId', 'waleEnd', 'gauge'])
    ctxData[what] = stitch.meta(node, what)[0] || 0;
  return Object.assign(ctxData, {
    // general
    id: stitch.id,
    index,
    shapes: stitch.meta('shape'),
    anchors: [],
    flat: stitch.meta('flat').length > 0,
    siblings: stitch.courses.size,
    links: stitch.wales.size
  });
}
/**
 * Select all stitches but modifies the associated nodes
 *
 * @param mapFunc the mapping
 * @return the new pattern selection with remapped nodes
 */
Pattern.prototype.map = function(mapFunc){
  return new Pattern(this.context, this.stitches, this.indices, this.nodes.map(mapFunc), this.id2idx, this.passID);
};
Pattern.prototype.swapXY = function(revX, revY){
  if(revX){
    if(revY){
      return this.map(n => Object.assign({}, n, {
        courseId:   n.waleEnd - n.waleId,
        courseEnd:  n.waleEnd,
        waleId:     n.courseEnd - n.courseId,
        waleEnd:    n.courseEnd
      }));
    } else {
      return this.map(n => Object.assign({}, n, {
        courseId:   n.waleId,
        courseEnd:  n.waleEnd,
        waleId:     n.courseEnd - n.courseId,
        waleEnd:    n.courseEnd
      }));
    }
  } else {
    if(revY){
      return this.map(n => Object.assign({}, n, {
        courseId:   n.waleEnd - n.waleId,
        courseEnd:  n.waleEnd,
        waleId:     n.courseId,
        waleEnd:    n.courseEnd
      }));
    } else {
      return this.map(n => Object.assign({}, n, {
        courseId:   n.waleId,
        courseEnd:  n.waleEnd,
        waleId:     n.courseId,
        waleEnd:    n.courseEnd
      }));
    }
  }
};
Pattern.prototype.rot90 = function(num){
  switch(num){
    case undefined:
    case 1:
      return this.swapXY(false, true);
    case 2:
      return this.map(n => Object.assign({}, n, {
        courseId:   n.courseEnd - n.courseId,
        waleId:     n.waleEnd - n.waleId
      }));
    case 3:
      return this.swapXY(true, false);
    default:
      return this;
  }
};

/**
 * Get a list of reachable stitches from a list of shapes.
 * The list must include a regular shape with sequential courses.
 *
 * @param shapes the list of shapes
 * @return a list of stitches reachable from one of the regular shapes
 */
function stitchesFromShapes(shapes){
  let shape0 = Array.isArray(shapes) ? shapes[0] : shapes;
  assert(shape0, 'No shape found for patterning');
  let crs0 = shape0.getCourse(0) || shape0.getCourse('base');
  assert(crs0, 'No first course for patterning');
  let stitch0 = crs0.first();
  assert(stitch0, 'No first stitch for patterning');
  return stitch0.all();
}

/**
 * Applies patterning on top of a set of shapes
 * This applies a sequence of patterns programs:
 * - an initial global pattern
 * - individual per-shape patterns
 * - a final global pattern
 *
 * @param shapes the list of shapes
 */
Pattern.transform = function(shapes){
  if(shapes.length == 0)
    return;
  let t = Timer.create();
  let stitches = stitchesFromShapes(shapes);

  // 1. Apply global before
  if(env.global.beforePattern)
    Pattern.eval(env.global.beforePattern, new Pattern(null, stitches));

  // 2. Apply per shape
  for(let shape of shapes){
    if(shape.node.pattern){
      const shapeStitches = stitches.filter(s => s.meta('shape').includes(shape.node.id));
      Pattern.eval(shape.node.pattern.toString(), new Pattern(shape, shapeStitches));
    }
  }

  // 3. Apply global after
  if(env.global.afterPattern)
    Pattern.eval(env.global.afterPattern, new Pattern(null, stitches));

  t.measure('tran');
  console.log('Pattern', t.toString());
};
/**
 * Clears the pattern information of a set of shapes
 * 
 * @param shapes the list of shapes
 */
Pattern.clearShapes = function(shapes){
  let stitches = stitchesFromShapes(shapes);
  Pattern.clearStitches(stitches);
};
/**
 * Clears the pattern information of a set of stitches
 *
 * @param stitches the stitches to clear
 */
Pattern.clearStitches = function(stitches){
 for(let s of stitches)
   s.pattern = P.STITCH; // reset all to default
};
/**
 * Evaluate a pattern program on top of a pattern selection
 *
 * @param code the code to evaluate
 * @param pat the pattern selection
 * @param args an optional object containing pattern code arguments to be passed
 * @see DSL.eval
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval
 * @return the output of the pattern program if any (usually none)
 */
Pattern.eval = function(code, pat, args){
  if(args){
    console.assert(typeof args == 'object', 'args must be an object whose keys are argument names');
    return DSL.eval(code, Object.assign({ pat, math: Math, noise }, args), DSL.range, env.verbose);
  } else 
    return DSL.eval(code, { pat, math: Math, noise }, DSL.range, env.verbose);
};

/**
 * Attempt to run the the given pattern code on some arbitrary input
 *
 * @param code the patterner code
 */
Pattern.compile = function(code){
  Pattern.eval(code, new Pattern(null, []));
};

// ----------------------------------------------------------------------------
// --- Stitch operations ------------------------------------------------------
// ----------------------------------------------------------------------------
Pattern.prototype.proc = function(proc){
  for(let idx of this.indices)
    proc(this.stitches[idx]);
  return this;
};
Pattern.prototype.set = function(type) {
  if(this.passID != -1){
    for(let idx of this.indices){
      const stitch = this.stitches[idx];
      stitch.pattern = type;
      stitch.meta(this.passID, P.PASS_STORAGE, type);
    }
  } else { 
    for(let idx of this.indices)
      this.stitches[idx].pattern = type;
  }
  return this;
};
Pattern.prototype.mod = function(type) {
  for(let idx of this.indices)
    this.stitches[idx].modifier = type;
  return this;
};
Pattern.prototype.stitch =
Pattern.prototype.knit = function(reversed){
  return this.set(reversed ? P.PURL : P.STITCH);
};
Pattern.prototype.purl = function(){
  return this.stitch(true);
};
Pattern.prototype.miss = function(){
  return this.set(P.MISS);
};
Pattern.prototype.tuck = function(){
  return this.set(P.TUCK);
};
Pattern.prototype.move = function(...args){
  return this.set(P.moveFor(...args));
};
Pattern.prototype.left = function(...args){
  return this.move('left', ...args);
};
Pattern.prototype.right = function(...args){
  return this.move('right', ...args);
};
Pattern.prototype.cable =
Pattern.prototype.cross = function(...args){
  return this.set(P.crossFor(...args));
};
Pattern.prototype.scalable = function(){
  return this.mod(P.SCALABLE);
};
Pattern.prototype.tileable = function(){
  return this.mod(P.TILEABLE);
};
Pattern.prototype.singular = function(){
  return this.mod(P.SINGULAR);
};
Pattern.prototype.color =
Pattern.prototype.mark = function(mark, mode){
  if(!mode)
    mode = 'set';
  switch(mode){
    case 'add':
      this.proc(function(n){
        n.mark += mark;
      });
      break;

    case 'remove':
      this.proc(function(n){
        n.mark -= mark;
      });
      break;

    case 'multiply':
      this.proc(function(n){
        n.mark *= mark;
      });
      break;

    case 'or':
      this.proc(function(n){
        n.mark |= mark;
      });
      break;

    case 'and':
      this.proc(function(n){
        n.mark &= mark;
      });
      break;

    case 'xor':
      this.proc(function(n){
        n.mark ^= mark;
      });
      break;

    case 'set':
      /* falls through */
    default:
      this.proc(function(n){
        n.mark = mark;
      });
      break;
  }
  return this;
};

// ----------------------------------------------------------------------------
// --- Stitch queries ---------------------------------------------------------
// ----------------------------------------------------------------------------

/**
 * Select all stitches of a pattern source
 *
 * @return the new stitch selection
 */
Pattern.prototype.all = function(){
  return this.withIndices(this.stitches.map((s, i) => i));
};
/**
 * Filter the current pattern selection
 *
 * @param predicate the node predicate
 * @return the filtered stitch selection
 */
Pattern.prototype.filter = function(predicate){
  return this.withIndices(this.indices.filter(i => predicate(this.nodes[i], this.stitches[i].type)));
};
/**
 * Filter the all selection directly.
 * Slightly faster than applying consecutively this.all().filter(predicate)
 *
 * @param predicate
 * @return the filtered stitch selection
 */
Pattern.prototype.filterAll = function(predicate){
  let indices = [];
  for(let i = 0; i < this.stitches.length; ++i){
    if(predicate(this.nodes[i], this.stitches[i].type))
      indices.push(i);
  }
  return this.withIndices(indices);
};

// 
// --- Indexed queries --------------------------------------------------------
// 

Pattern.prototype.side = function(side){
  return this.select([0, -1], [0, -1], side);
};

/**
 * Interpret range value
 *
 * @param value the range component (either start or end)
 * @param valueEnd the local context's end value
 * @return the effective location number
 */
function interpretRange(value, valueOffset, valueEnd){
  if(value < 0)
    return value + valueEnd + 1;
  if(value > 0 && value < 1)
    return valueOffset + value * valueEnd;
  return valueOffset + value;
}

function sidedRange(value, valueEnd, side){
  switch(side){
    case 'front':
    case 0:
      return interpretRange(value, 0, Math.floor(valueEnd / 2));
    case 'back':
    case 1:
      return interpretRange(value, Math.ceil(valueEnd / 2), valueEnd);
    default:
      return interpretRange(value, 0, valueEnd);
  }
}

/**
 * Select a subset of stitches based on indices
 *
 * @param rows the course range
 * @param cols the wale range
 * @return the new stitch selection
 */
Pattern.prototype.select = function(rows, cols, side){
  // normalize $rows range
  if(!Array.isArray(rows))
    rows = [rows, rows, 1];
  // normalize $cols range
  if(!Array.isArray(cols))
    cols = [cols, cols, 1];
  // interval step
  const rowStep = rows[2] || 1;
  const colStep = cols[2] || 1;
  // side information
  if(!this.context || !this.context.sided)
    side = 'both';
  // generic filter
  return this.filter(n => {
    // local normalization of ends that are fractional
    let fromRow = interpretRange(rows[0], 0, n.courseEnd);
    let toRow   = interpretRange(rows[1], 0, n.courseEnd);
    let fromCol = sidedRange(cols[0], n.waleEnd, side);
    let toCol   = sidedRange(cols[1], n.waleEnd, side);
    return n.courseId >= fromRow && n.courseId <= toRow
      &&   n.waleId >= fromCol   && n.waleId <= toCol
      &&   (rowStep == 1 || ((n.courseId - fromRow) % rowStep == 0))
      &&   (colStep == 1 || ((n.waleId   - fromCol) % colStep == 0));
  });
};
Pattern.prototype.courses = function(range){
  // normalize range
  if(!Array.isArray(range))
    range = [range, range, 1];
  // interval step
  const step = range[2] || 1;
  // generic filter
  return this.filter(n => {
    // local normalization of ends that are fractional
    let from = interpretRange(range[0], 0, n.courseEnd);
    let to   = interpretRange(range[1], 0, n.courseEnd);
    return n.courseId >= from && n.courseId <= to
      &&  (step == 1 || ((n.courseId - from) % step == 0));
  });
};
Pattern.prototype.wales = function(range, side){
  // normalize range
  if(!Array.isArray(range))
    range = [range, range, 1];
  // interval step
  const step = range[2] || 1;
  // side information
  if(!this.context || !this.context.sided)
    side = 'both';
  if(side == 'both' || side === undefined){
    // generic filter
    return this.filter(n => {
      // local normalization of ends that are fractional
      let from = interpretRange(range[0], 0, n.waleEnd);
      let to   = interpretRange(range[1], 0, n.waleEnd);
      return n.waleId >= from && n.waleId <= to
        &&  (step == 1 || ((n.waleId - from) % step == 0));
    });
  } else {
    // use extra wale filtering with full select query
    return this.select([0, -1], range, side);
  }
};

// 
// --- Neighborhood queries -------------------------------------------------------
// 

/**
 * Select the neighbors of the current selection within some range
 *
 * @param range the range of rings to select
 * @return the new neighborhood
 */
Pattern.prototype.neighbors = function(range /*, diags */){
  if(!range)
    range = [1, 1, 1]; // 1-ring neighborhood
  else if(!Array.isArray(range))
    range = [range, range, 1]; // N-ring neighborhood
  assert(range[2] == 1, 'Neighbors can only use step=1');
  let N = this.stitches.length; // workspace size
  let order = new Uint8Array(N); // initialized to 0
  let current = this.indices;
  
  // first pass: mark current selection to 1
  for(let idx of current){
    order[idx] = 1;
  }
  
  // next passes: mark neighbors iteratively
  for(let r = 1; r <= range[1] && current.length; ++r){
    current = current.reduce((accu, idx) => {
      let s = this.stitches[idx];
      for(let n of s.neighbors()){
        let nidx = this.id2idx[n.id]; // get neighbor's index
        if(order[nidx] == 0){
          order[nidx] = r + 1;
          accu.push(nidx); // no duplicates because of order information
        }
      }
      return accu;
    }, []);
  }
  // create new selection that matches the range information
  current = [];
  for(let i = 0; i < N; ++i){
    let r = order[i] - 1;
    if(r >= range[0] && r <= range[1])
      current.push(i);
  }
  return this.withIndices(current);
};

/**
 * Filter current stitches to those that
 * have neighbors outside the selection.
 *
 * When used on a shape, this also includes
 * nodes that have no neighbors outside the selection
 * but which have minimal or extremal courseId.
 */
Pattern.prototype.boundaries = function(){
  // XXX select linear array vs hashmap depending on size of current selection
  let nodeMap = {};
  for(let idx of this.indices){
    nodeMap[idx] = true;
  }
  if(this.context){
    return this.filter((node, stitch) => {
      if(node.names.length)
        return true;
      return stitch.neighbors().every(s => this.id2idx[s.id] in nodeMap);
    });
  } else {
    return this.filter((node, stitch) => {
      return stitch.neighbors().every(s => this.id2idx[s.id] in nodeMap);
    });
  }
};

// 
// --- Set operations ---------------------------------------------------------
// 

/**
 * Select the intersection with another selection
 *
 * @param sel the other selection
 * @return their intersection
 */
Pattern.prototype.and =
Pattern.prototype.inter = function(sel){
  let flags = new Uint8Array(this.stitches.length);
  for(let idx of this.indices)
    flags[idx] = 1;
  return this.withIndices(sel.indices.reduce((accu, idx) => {
    if(flags[idx])
      accu.push(idx);
    return accu;
  }, []));
};
/**
 * Select the union with another selection
 *
 * @param sel the other selection
 * @return their union
 */
Pattern.prototype.or =
Pattern.prototype.union = function(sel){
  let flags = new Uint8Array(this.stitches.length);
  for(let idx of this.indices)
    flags[idx] = 1;
  return this.withIndices( sel.indices.reduce((accu, idx) => {
    if(!flags[idx])
      accu.push(idx);
    return accu;
  }, this.indices.slice()));
};
/**
 * Subtract a selection from this one
 *
 * @param sel the selection to subtract
 * @return the difference selection
 */
Pattern.prototype.minus = function(sel){
  let flags = new Uint8Array(this.stitches.length);
  for(let idx of sel.indices)
    flags[idx] = 1;
  return this.withIndices(this.indices.filter(idx => {
    return !flags[idx];
  }));
};
/**
 * Select the inverse of the current selection
 */
Pattern.prototype.inverse = function(){
  let flags = new Uint8Array(this.stitches.length);
  for(let idx of this.indices)
    flags[idx] = 1;
  let newIndices = [];
  for(let i = 0, n = this.stitches.length; i < n; ++i){
    if(!flags[i])
      newIndices.push(i);
  }
  return this.withIndices(newIndices);
};

// 
// --- Named queries ----------------------------------------------------------
// 

/**
 * Return the node identifier for a given name
 *
 * @param name either a string or a numeric identifier
 * @return the node id or -1
 */
function getNodeID(name){
  // find the matching node
  let node = null;
  if(typeof name == 'string')
    node = env.nodes.find(n => n.name == name);
  else {
    assert(typeof name == 'number', 'Invalid shape argument: ' + name);
    node = env.node.find(n => n.id == name);
  }
  return node ? node.id : -1;
}

/**
 * Select all stitches that come from a shape
 *
 * @param name the name of the shape node (or its id)
 * @return its set of stitches
 */
Pattern.prototype.shape = function(name){
  let nodeID = getNodeID(name);
  if(nodeID == -1)
    return this.withIndices([]);
  else
    return this.filter(n => n.shapes.includes(nodeID));
};

/**
 * Select all stitches that have some name annotation
 */
Pattern.prototype.named = function(){
  return this.filter(n => n.names.length);
};

/**
 * Select all stitches that match an interface name.
 * 
 * @param name the interface name
 */
Pattern.prototype.itf = function(name){
  return this.filter(n => n.names.includes(name));
};

/**
 * Select all stitches associated with a named anchor
 *
 * @param name the anchor name
 */
Pattern.prototype.anchor = function(name){
  return this.filter(n => n.anchors.includes(name));
};

// 
// --- Masking queries --------------------------------------------------------
// 

/**
 * Filter stitches using a mask predicate on the grid domain spanned
 * by the current selection.
 * The mask predicate receives normalized coordinates in [0;1]^2,
 * together with the real region's height and width, and the target node, i.e.
 * the parameters (y, x, h, w, s)
 * and should return whether to keep or not the stitch.
 *
 * The adapting version uses a local width w, varying with y,
 * whereas the non-adapting one uses a global w value.
 *
 * @param predicate (y,x,h,w,s)=>(true|false)
 * @param adapt whether to make the grid stretch locally (i.e. w varies with y)
 * @return the masked selection
 */
Pattern.prototype.mask = function(predicate, adapt){
  if(adapt){
    // compute extents
    let minCrs = Infinity;
    let maxCrs = -Infinity;
    let minWal = {}; // adapt
    let maxWal = {}; // adapt
    for(let idx of this.indices){
      let node = this.nodes[idx];
      minCrs = Math.min(minCrs, node.courseId);
      maxCrs = Math.max(maxCrs, node.courseId);
      if(node.courseId in minWal){
        minWal[node.courseId] = Math.min(minWal[node.courseId], node.waleId);
        maxWal[node.courseId] = Math.max(maxWal[node.courseId], node.waleId);
      } else {
        minWal[node.courseId] = node.waleId;
        maxWal[node.courseId] = node.waleId;
      }
    }
    // create masked pattern using predicate on location
    // within extents in normalized coordinates (y,x) in [0;1]^2
    return this.withIndices(this.indices.filter(idx => {
      let node = this.nodes[idx];
      let w = minWal[node.courseId];
      let W = maxWal[node.courseId];
      return predicate(
        (node.courseId - minCrs) / (maxCrs - minCrs + 1),
        (node.waleId - w) / (W - w + 1),
        maxCrs - minCrs + 1,
        W - w + 1,
        node
      );
    }));
  } else {
    // compute extents
    let minCrs = Infinity;
    let maxCrs = -Infinity;
    let minWal = Infinity;
    let maxWal = -Infinity;
    for(let idx of this.indices){
      let node = this.nodes[idx];
      minCrs = Math.min(minCrs, node.courseId);
      maxCrs = Math.max(maxCrs, node.courseId);
      minWal = Math.min(minWal, node.waleId);
      maxWal = Math.max(maxWal, node.waleId);
    }
    // create masked pattern using predicate on location
    // within extents in normalized coordinates (y,x) in [0;1]^2
    return this.withIndices(this.indices.filter(idx => {
      let node = this.nodes[idx];
      return predicate(
        (node.courseId - minCrs) / (maxCrs - minCrs + 1),
        (node.waleId - minWal)   / (maxWal - minWal + 1),
        maxCrs - minCrs + 1,
        maxWal - minWal + 1,
        node
      );
    }));
  }
};

Pattern.prototype.maskdo = function(map, adapt){
  return this.mask((y, x, h, w, s) => {
    return map(y, x, h, w, this.stitchPattern(s.id));
  }, adapt);
};

/**
 * Creates a grid from the bits of a number
 *
 * @param num the number, whose bits are used from most significant to least significant
 * @param width the expect grid width (for padding purposes on the left)
 * @return the grid
 */
function bitGrid(num, width){
  let grid = num.toString(2).split('').map(c => parseInt(c));
  if(!width)
    return grid;
  // pad on the left with 0 until width matches
  while(grid.length % width)
    grid.unshift(0);
  return grid;
}

/**
 * Rounding for stretch sampling
 *
 * @param value the ratio to round
 * @param length the sampling length
 * @return round(value) but below length-1
 */
function roundsamp(value, length){
  const v = Math.floor(value);
  if(v >= length)
    return length - 1;
  else
    return v;
}

/**
 * Uses a grid-like pattern to mask the current selection,
 * which includes manual grids or images.
 * The pattern is stretched to fit the current selection's boundaries.
 * To not stretch the pattern, use Pattern::tile instead.
 *
 * @param grid the data to use for masking
 * @param gridWidth the width of the grid (if using a linear data array)
 * @param pixelSize the amount of cells per pixels
 * @param pixelOffset the offset of the pixel to use for thresholding
 * @param threshFunc (val)=>(true|false)
 * @param adapt whether to adapt to rows locally
 */
Pattern.prototype.stretch = function(grid, gridWidth, pixelSize, pixelOffset, threshFunc, adapt){
  if(typeof grid == 'number')
    grid = bitGrid(grid, gridWidth);
  if(gridWidth){
    if(!pixelSize)
      pixelSize = 1;
    if(!pixelOffset)
      pixelOffset = 0;
    if(!threshFunc)
      threshFunc = x => x;
    const w = gridWidth;
    assert(grid.length % (w * pixelSize) == 0, 'Invalid grid width w.r.t. the grid argument');
    const h = grid.length / (w * pixelSize);
    // array containing 2d grid
    return this.mask((y, x, _1, _2, s) => {
      let gX = roundsamp(x * w, w);
      let gY = roundsamp(y * h, h);
      return threshFunc(grid[(gY * w + gX) * pixelSize + pixelOffset], s);
    }, adapt);
  } else if (threshFunc){
    // array of arrays
    return this.mask((y, x, h, w, s) => {
      let row = grid[roundsamp(y * grid.length, grid.length)]; // not y * (grid.length-1)
      return threshFunc(row[roundsamp(x * row.length, row.length)], s);
    }, adapt);
  } else {
    // array of arrays
    return this.mask((y, x) => {
      let row = grid[roundsamp(y * grid.length, grid.length)];
      return row[roundsamp(x * row.length, row.length)];
    }, adapt);
  }
};

Pattern.prototype.stretchdo = function(grid, ...args){
  let gridWidth = 0;
  let map = Pattern.mapChar;
  for(let i = 0; i < args.length; ++i){
    if(typeof args[i] == 'number')
      gridWidth = args[i];
    else if(typeof args[i] == 'function')
      map = args[i];
  }
  return this.stretch(grid, gridWidth, 1, 0, (v, s) => {
    return map(v, this.stitchPattern(s.id));
  });
};

/**
 * Non-stretching variant of grid-like patterning.
 * Work like Pattern::pattern(), but does not stretch the underlying
 * pattern and instead tiles it over the selection.
 */
Pattern.prototype.tile = function(grid, gridWidth, pixelSize, pixelOffset, threshFunc, adapt){
  if(typeof grid == 'number')
    grid = bitGrid(grid, gridWidth);
  if(gridWidth){
    if(!pixelSize)
      pixelSize = 1;
    if(!pixelOffset)
      pixelOffset = 0;
    if(!threshFunc)
      threshFunc = x => x;
    const imgW = gridWidth;
    assert(grid.length % (imgW * pixelSize) == 0, 'Invalid grid width w.r.t. the grid argument');
    const imgH = grid.length / (imgW * pixelSize);
    // array containing 2d grid
    return this.mask((y, x, h, w, s) => {
      let j = Math.round(y * h);
      let i = Math.round(x * w);
      let gX = i % imgW;
      let gY = j % imgH;
      return threshFunc(grid[(gY * imgW + gX) * pixelSize + pixelOffset], s);
    }, adapt);
  } else if(threshFunc) {
    // array of arrays
    return this.mask((y, x, h, w, s) => {
      let row = grid[Math.round(y * h) % grid.length];
      return threshFunc(row[Math.round(x * w) % row.length], s);
    }, adapt);
  } else {
    // array of arrays
    return this.mask((y, x, h, w) => {
      let row = grid[Math.round(y * h) % grid.length];
      return row[Math.round(x * w) % row.length];
    }, adapt);
  }

};

Pattern.mapChar = function(c, p){
  switch(c.toLowerCase()){
    case 'k': p.knit(); break;
    case 'p': p.purl(); break;
    case 't': p.tuck(); break;
    case 'm': p.miss(); break;
    case 'l': p.left(); break;
    case 'r': p.right(); break;
    case 'xl+': p.cross('left', 'upper'); break;
    case 'xl-': p.cross('left', 'lower'); break;
    case 'xr+': p.cross('right', 'upper'); break;
    case 'xr-': p.cross('right', 'lower'); break;
    default: return false;
  }
  return true;
};

Pattern.prototype.tiledo = function(grid, ...args){
  let gridWidth = 0;
  let map = Pattern.mapChar;
  for(let i = 0; i < args.length; ++i){
    if(typeof args[i] == 'number')
      gridWidth = args[i];
    else if(typeof args[i] == 'function')
      map = args[i];
  }
  return this.tile(grid, gridWidth, 1, 0, (v, s) => {
    return map(v, this.stitchPattern(s.id));
  });
};

let dataStore = {};

/**
 * Use an image as mask for patterning
 *
 * @param src the image source
 * @param compID the image channel to use (defaults to 0)
 * @param threshFunc the thresholding function to use (defaults to identity)
 */
Pattern.prototype.img = function(src, compID, threshFunc, adapt){
  let img = src;
  if(typeof src == 'string'){
    if(src in dataStore){
      img = dataStore[src];
    } else {
      Pattern.loadImage(src, src, true);
      console.log('Image loading, try again');
      return this.withIndices([]);
    }
  }
  if(!img.width || !img.height){
    console.log('Image either still loading or empty');
    return this.withIndices([]);
  }
  return this.stretch(img.data, img.width, 4, compID, threshFunc, adapt); // RGBA
};

Pattern.loadImage = function(url, name, flipY, doNotStore){
  return new Promise((accept, reject) => {
    let img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      let canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      let ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, img.width, img.height);
      if(flipY){
        ctx.translate(0, img.height-1);
        ctx.scale(1, -1);
      }
      ctx.drawImage(img, 0, 0, img.width, img.height);
      let data = ctx.getImageData(0, 0, img.width, img.height);
      dataStore[name] = data;

      // save global resource mapping
      if(!doNotStore)
        env.setResource(name, url);

      accept(data);
    };
    img.onerror = reject;
    img.src = url;
  });
};

Pattern.preload = function(){
  return new Promise(accept => {
    let total = 0, done = 0;
    for(let name of env.getResourceKeys()){
      // skip if already in store (note: this may create conflictsOA
      if(name in dataStore)
        continue;
      // one more to load
      ++total;
      // we try loading the resource
      let url = env.getResource(name);
      Pattern.loadImage(url, name, true, true).then(() => {
        console.log('Successfully loaded resource:', name);
        if(++done >= total)
          accept();
      }).catch(err => {
        assert.error('Could not load resource:', name, '|', err);
        if(++done >= total)
          accept();
      });
    }
    if(total == 0)
      accept(); // nothing to do
  });
};

Pattern.prototype.text = function(str, style, adapt){
  let key = str + '@' + style;
  // cache image mask
  let img;
  if(key in dataStore){
    img = dataStore[key];
  } else {
    // compute ImageData using canvas
    let canvas = document.createElement('canvas');
    canvas.width = canvas.height = 10; // initial size
    let ctx = canvas.getContext('2d');
    // 1) figure out text size
    ctx.font = style;
    // @see https://stackoverflow.com/questions/1134586/how-can-you-find-the-height-of-text-on-an-html-canvas
    // let textMetrics = ctx.measureText(str);
    // let height = textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;
    let width = ctx.measureText(str).width;
    let height = ctx.measureText('M').width; // /!\ this is a hack until TextMetrics is supported
    // 2) apply reasonable size
    canvas.width = width;
    canvas.height = height;
    ctx.font = style; // removed from setting width
    // 3) draw text and get corresponding image data
    ctx.clearRect(0, 0, width, height);
    ctx.translate(0, height-1);
    ctx.scale(1, -1);
    ctx.fillStyle = 'white';
    ctx.fillText(str, 0, height);
    assert(ctx.measureText(str).width == width, 'Text width changed');
    img = ctx.getImageData(0, 0, width, height);
    dataStore[key] = img;
  }
  if(!img.width || !img.height){
    console.log('Empty text mask');
    return this.withIndices([]);
  }
  return this.stretch(img.data, img.width, 4, 3, c => c, adapt); // RGBA
};

module.exports = Object.assign(Pattern, P);
