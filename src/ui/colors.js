// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../skeleton.js');

/**
 * Color of skeleton graph nodes
 */
function nodeColor(n, alpha){
  const useAlpha = alpha != undefined;
  switch(n.category){
    case sk.NODE_SHEET: {
      let type = n.type || n.node.type;
      if(type == sk.CYLINDER)
        return useAlpha ? 'rgba(0, 153, 255, ' + alpha + ')' : '#09F';
      else if(type == sk.FLAT)
        return useAlpha ? 'rgba(0, 170, 0, ' + alpha + ')'   : '#0A0';
      else
        return useAlpha ? 'rgba(0, 0, 0, ' + alpha + ')' : '#000';
    } break;
    case sk.NODE_JOINT:   return useAlpha ? 'rgba(255, 170, 0, ' + alpha + ')' : '#FA0';
    case sk.NODE_SPLIT:   return useAlpha ? 'rgba(255, 0, 255, ' + alpha + ')' : '#F0F';
    case sk.NODE_CUSTOM:  return useAlpha ? 'rgba(255, 255, 0, ' + alpha + ')' : '#FF0';
    case 'param':         return 'rgba(255, 0, 0, 0.5)';
    default: return '#000';
  }
}

/**
 * Base textual RGB palette
 */
const palette = [
'rgb( 255,   0,  16)',
'rgb(  43, 206,  72)',
'rgb( 255, 255, 128)',
'rgb(  94, 241, 242)',
'rgb(   0, 129,  69)',
'rgb(   0,  92,  49)',
'rgb( 255,   0, 190)',
'rgb( 194,   0, 136)',
'rgb( 126,   0, 149)',
'rgb(  96,   0, 112)',
'rgb( 179, 179, 179)',
'rgb( 128, 128, 128)',
'rgb( 255, 230,   6)',
'rgb( 255, 164,   4)',
'rgb(   0, 164, 255)',
'rgb(   0, 117, 220)',
'rgb( 117,  59,  59)'
];

/**
 * RGB array palette
 */
const rgbPalette = palette.map(str => {
  let tokens = str.substring(4, 18).split(',');
  return tokens.map(str => parseInt(str));
});

/**
 * Hex string palette
 */
const hexPalette = rgbPalette.map(([r, g, b]) => {
  let tc = (str) => str.length == 1 ? '0' + str : str;
  return '#' + tc(r.toString(16)) + tc(g.toString(16)) + tc(b.toString(16));
});

const ColorDelta = 100;

/**
 * Color of pattern instruction
 *
 * @param pattern the pattern instruction
 * @param s whether to change the alpha value
 * @param alpha the alpha value
 * @return a string representing the color
 */
function patternColor(pattern, s, alpha){
  if(s){
    if(alpha === undefined)
      alpha = 0.5;
    let r = 0, g = 0, b = 0;
    if(pattern >= 1 && pattern <= rgbPalette.length)
      [r, g, b] = rgbPalette[pattern - 1];
    r = Math.min(255, r + ColorDelta);
    g = Math.min(255, g + ColorDelta);
    b = Math.min(255, b + ColorDelta);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  } else {
    return hexPalette[pattern - 1] || '#000';
  }
}

function leftZeroPad(str, width){
  while(str.length < width)
    str = '0' + str;
  return str;
}

function hexColor(hex, s, alpha){
  // color dependent on side
  if(s){
    if(alpha === undefined)
      alpha = 0.5;
    let r = Math.min(255, ((hex >> 16) & 0xFF) + ColorDelta);
    let g = Math.min(255, ((hex >> 8)  & 0xFF) + ColorDelta);
    let b = Math.min(255, ((hex)       & 0xFF) + ColorDelta);
    hex = (r << 16) | (g << 8) | b;
  }

  // alpha(0 or 2)
  let alphaStr;
  if(alpha)
    alphaStr = leftZeroPad((alpha <= 1.0 ? Math.round(255 * alpha) : alpha).toString(16), 2);
  else
    alphaStr = '';
  // #color(6) | alpha(0 or 2)
  return '#' + leftZeroPad(hex.toString(16), 6) + alphaStr;
}

module.exports = {
  // functions
  nodeColor,
  patternColor,
  hexColor,
  // palettes
  palette,
  rgbPalette,
  hexPalette
};
