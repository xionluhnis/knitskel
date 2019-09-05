// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// constants
module.exports = {
  // types of nodes
  NODE_ANCHOR:    'anchor',
  NODE_INTERFACE: 'interface',
  NODE_JOINT:     'joint',
  NODE_SHEET:     'sheet',
  NODE_SPLIT:     'split',
  NODE_CUSTOM:    'custom',
  // short types
  ANCHOR:     'anchor',
  INTERFACE:  'interface',
  JOINT:      'joint',
  SHEET:      'sheet',
  SPLIT:      'split',
  CUSTOM:     'custom',
  // common types
  CYLINDER:       'cylinder',
  FLAT:           'flat',
  AUTO:           'auto',
  // common states
  OPEN:           'open',
  CLOSED:         'closed',
  COLLAPSED:      'collapse',
  ZIGZAG_CLOSED:  'zigzag',
  ZIGZAG_RETURN:  'zigzagreturn',
  CONNECTED:      'connected',
  // types of alignments
  ALIGN_UNIFORM:  'uniform',
  ALIGN_LEFT:     'left',
  ALIGN_CENTER:   'center',
  ALIGN_RIGHT:    'right',
  ALIGN_MANUAL:   'manual',
  // automatic layout
  LAYOUT_AUTO:    'auto',
  // types of anchors
  ANCHOR_POINT:   'point',
  ANCHOR_SLIT:    'slit',
  ANCHOR_CIRCLE:  'circle',
  // ANCHOR_POLYGON: 'polygon,
  // type of split support
  SUPPORT_BOTH:   'both',
  SUPPORT_FRONT:  'front',
  SUPPORT_BACK:   'back',
  SUPPORT_SIDE:   'side',
  supports:       ['both', 'front', 'back', 'side'],
  // default shaping programs
  SHAPER_UNIFORM: 'uniform',
  SHAPER_RIGHT:   'right',
  SHAPER_LEFT:    'left',
  SHAPER_CENTER:  'center',
  SHAPER_SIDES:   'sides',
  SHAPER_NONE:    'none',
  // pattern direction
  PATTERN_AUTO:   'auto',
  PATTERN_UPWARD: 'upward',
  PATTERN_DOWNWARD: 'downward',
  // layout
  GAUGE_FULL:     'full',
  FULL_GAUGE:     'full',
  GAUGE_HALF:     'half',
  HALF_GAUGE:     'half',
  // increases
  INCREASE_AUTO:  'auto',
  INCREASE_SPLIT: 'split',
  INCREASE_KICKBACK: 'kickback',
  // casting type
  CASTING_AUTO:     'auto',
  CASTING_SAFE:     'safe',
  CASTING_UNSAFE:   'unsafe',
  // cast-on
  CASTON_AUTO:      'auto',
  CASTON_INTERLOCK: 'interlock',
  CASTON_KICKBACK:  'kickback',
  CASTON_TUCK:      'tuck',
  CASTON_PRECAST:   'precast',
  // CASTON_PRECAST_OPEN:    'precast_open',
  // CASTON_PRECAST_CLOSED:  'precast_closed',
  CASTON_NONE:      'none',
  // cast-off
  CASTOFF_AUTO:     'auto',
  CASTOFF_DIRECT:   'direct',
  CASTOFF_REVERSE:  'reverse',
  CASTOFF_PICKUP:   'pickup',
  CASTOFF_NONE:     'none'
};
