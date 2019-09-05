// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const { NUMBER, FUN1D, STRING, LAYOUT } = require('../param.js');
const sk = require('./constants.js');
const { init, register } = require('./node.js');

function Joint(){
  init(this, 'joint', 'joint');
}

register('joint', Joint, {
  inherits:   'default',
  interfaces: 'default',
  params: {
    'rows':       [NUMBER, 10, { min: 1, integer: true }],
    'width':      [FUN1D,  5],
    'alignment':  [STRING, sk.ALIGN_CENTER,
      { within: [sk.ALIGN_CENTER, sk.ALIGN_LEFT, sk.ALIGN_RIGHT] }],
    'layout':     [LAYOUT]
  },
  toString: ['id', 'name']
});

module.exports = Joint;
