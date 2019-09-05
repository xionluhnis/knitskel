// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const { STRING, NUMBER, FUN1D, SHAPER } = require('../param.js');
const sk = require('./constants.js');
const { init, register } = require('./node.js');

function Sheet(){
  init(this, 'sheet', 'sheet');
}

register('sheet', Sheet, {
  inherits:   'default',
  interfaces: 'default',
  params: {
    'type':       [STRING,  sk.CYLINDER, { within: [sk.FLAT, sk.CYLINDER, sk.AUTO] }],
    'length':     [NUMBER,  10, { min: 1, integer: true }],
    'width':      [FUN1D,   10],
    'shaper':     [SHAPER,  sk.SHAPER_UNIFORM, {
        within: [ sk.SHAPER_UNIFORM, sk.SHAPER_SIDES, sk.SHAPER_CENTER, sk.SHAPER_LEFT, sk.SHAPER_RIGHT, sk.SHAPER_NONE ]
    }],
    'alignment':  [STRING,  sk.ALIGN_CENTER, { within: [sk.ALIGN_CENTER, sk.ALIGN_LEFT, sk.ALIGN_RIGHT] }]
  },
  toString: ['id', 'name', 'type']
});

module.exports = Sheet;
