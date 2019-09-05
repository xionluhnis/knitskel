// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');

// constants
const A = {
  NONE: 0,
  KNIT: 1,
  TUCK: 2,
  MISS: 3,
  SPLIT: 4,
  FB_KNIT: 5,
  KICKBACK: 6,
  SPLIT_MISS: 7
};
function Action(context, action, regular, reverse, source, targets, casting, pairing, restack, increaseType, increaseTarget){
  this.context = context;
  assert(action !== undefined, 'Action must be defined');
  this.action = action;
  this.regular = !!regular;
  this.reverse = !!reverse;
  this.source = source;
  this.targets = targets || [];
  this.casting = !!casting;
  this.pairing = pairing;
  this.restack = !!restack;
  this.increaseType = increaseType;
  this.increaseTarget = increaseTarget;
  assert(source && Array.isArray(targets),
    'Source must exist, and targets must be an array');
}
Action.from = function(stitch, options){
  assert(stitch, 'Must pass a stitch context');
  return new Action(stitch,
    options.action || Action.NONE,
    options.regular,
    options.reverse,
    options.source,
    options.targets || (options.target ? [options.target] : []),
    options.casting,
    options.pairing,
    options.restack,
    options.increaseType,
    options.increaseTarget
  );
};
Object.assign(Action, A);

const PassType = {
  CAST_ON: 1,
  CAST_OFF: 2,
  ACTION: 3,
  ACTIONS: 3,
  TRANSFER: 4,
  TRANSFERS: 4
};

function Pass(type, ystart, yend, sequence, actionMap, action, safeCast){
  this.type = type;
  this.yarnStarts = !!ystart;
  this.yarnEnds   = !!yend;
  this.sequence = sequence || [];
  this.actionMap = actionMap || {};
  this.action = action || '';
  this.safeCast = safeCast;
}
Pass.from = function(type, options){
  if(!options.sequence)
    options.sequence = [];
  if(!options.actionMap && options.action){
    options.actionMap = options.sequence.reduce((map, s) => {
      map[s.id] = options.action;
      return map;
    }, {});
  }
  return new Pass(type, options.yarnStarts, options.yarnEnds, options.sequence, options.actionMap, options.action, options.safeCast);
};

module.exports = {
  Action,
  PassType,
  Pass
};
