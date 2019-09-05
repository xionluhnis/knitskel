// Alexandre Kaspar <akaspar@mit.edu>
// Based on the work of Jim McCann <jmccann@cs.cmu.edu>
// @see https://github.com/textiles-lab
"use strict";

// --- imports
const fs = require('fs');

// --- constants

const LEFT_SPACE = 10 + 20*2 + 5;
const RIGHT_SPACE = 5 + 20*2 + 10;
const TOP_SPACE = 1 + 2 + 5;
const BOTTOM_SPACE = 5;
const BED_NEEDLES = 541;

// direction codes
const NONE = 0;
const LEFT = 6;
const RIGHT = 7;
const TRANSFER = 1;
const INV_DIR = {
  [LEFT]: RIGHT,
  [RIGHT]: LEFT,
  [TRANSFER]: TRANSFER,
  [NONE]: NONE
};

/**
 * DAT file (reader and writer)
 *
 */
function DATFile(width, height, filename) {
  this.filename = filename || 'output.dat';
  this.fullWidth = this.fullHeight = this.fullSize = 0;
  this.leftOffset = this.bottomOffset = 0;
  this.maxWidth = BED_NEEDLES;
  this.width = this.height = 0;
  this.data = [];
  this.allocate(width, height);
  this.needlePos = 'right';
  this.streaming = false;
}

/**
 * Maximum width
 */
DATFile.MAX_WIDTH = BED_NEEDLES;
/**
 * Spaces
 */
DATFile.BOTTOM_SPACE = BOTTOM_SPACE;
DATFile.LEFT_SPACE = LEFT_SPACE;
DATFile.RIGHT_SPACE = RIGHT_SPACE;
DATFile.TOP_SPACE = TOP_SPACE;

/**
 * Static constructor
 *
 * @param input a file name or a buffer object
 * @return the loaded DAT file
 */
DATFile.read = function(input, verbose){
  let dat = new DATFile();
  dat.read(input, verbose);
  return dat;
};

/**
 * Allocate a given number of lines  of given width.
 * Set the current line
 *
 * @param w width of the lines (number of instructions)
 * @param h number of lines
 */
DATFile.prototype.allocate = function(w, h) {
  this.width = w || 0;
  this.height = h || 0;
  let size = this.width * this.height;
  if(size <= 0) {
    this.data = [];
    return;
  }
  // extend workspace
  this.fullWidth  = this.width  + LEFT_SPACE + RIGHT_SPACE;
  this.fullHeight = this.height + BOTTOM_SPACE + TOP_SPACE;
  size = this.fullWidth * this.fullHeight;
  // reallocate buffer if necessary
  if(this.data.length != size) {
    this.data = new Array(size);
  }
};

/**
 * Allocate a given raw buffer of pixels
 *
 * @param w full width (includes margins)
 * @param h full height (includes margins)
 */
DATFile.prototype.allocatePixels = function(w, h) {
  this.fullWidth = w;
  this.fullHeight = h;
  console.assert(w > 0 && h > 0, 'Width and height must be strictly positive');
  let size = this.fullWidth * this.fullHeight;
  if(this.data.length != size)
    this.data = new Array(size);
};

/**
 * Create a new environment of given width.
 *
 * @param w number of instructions per line
 */
DATFile.prototype.create = function(w) {
  this.allocate(w, 1);
  // initialize current line
  this.current = 0; // first line
  this.streaming = true;
};

/**
 * Allocate a given number of full lines
 *
 * @param width the number of instructions per line
 * @param lines the number of lines to allocate
 * @param useFixedData whether to write fixed data (preamble and postamble)
 */
DATFile.prototype.allocateLines = function(width, lines, useFixedData) {
  if(useFixedData) {
    this.allocate(width, lines + 3 + 3);
    this.writeOptionBars();
    this.writePreamble();
    this.writePostamble();
    // initialize current line to above preamble
    this.current = 3;
  } else {
    this.allocate(width, BOTTOM_SPACE + lines + TOP_SPACE);
    // initialize current line to above margin
    this.current = 0;
  }
};

/**
 * Add a new empty line
 */
DATFile.prototype.newLine = function(){
  this.height += 1;
  this.fullHeight += 1;
  [].push.apply(this.data, new Array(this.fullWidth));
  this.current += 1;
};

/**
 * Remove the last line
 */
DATFile.prototype.removeLine = function(){
  console.assert(this.height, 'Removing height but none available!');
  this.height -= 1;
  this.fullHeight -= 1;
  this.data.splice(this.data.length - this.fullWidth, this.fullWidth);
  this.current -= 1;
};

/**
 * Set the instruction location on the bed
 *
 * @param needlePos either a needle index or one from 'left', 'center', 'right' (default)
 */
DATFile.prototype.setPosition = function(needlePos){
  if(needlePos < 0)
    this.needlePos = this.maxWidth + needlePos - this.width;
  else
    this.needlePos = needlePos;
};

/**
 * Set the maximum number of needles that can be used
 * which corresponds to the full bed width.
 * This is used to position the bed needles if not using right alignment.
 *
 * @param maxWidth number of needles on each bed
 */
DATFile.prototype.setBedWidth = function(maxWidth){
  this.maxWidth = maxWidth;
};

/**
 * Write option bars
 */
DATFile.prototype.writeOptionBars = function(){
  for(let line = 0; line < this.height; ++line){
    for(let op = 1; op <= 20; ++op){
      this.setLineOption(line, 'L' + op, 0);
      this.setLineOption(line, 'R' + op, 0);
    }
  }
};

/**
 * Get the data index for the beginning of a line
 *
 * @param line the line to get the index for (default to current)
 * @return the data index
 */
DATFile.prototype.getLineIndex = function(line) {
  if(line === undefined)
    line = this.current;
  return this.fullWidth * (BOTTOM_SPACE + line + this.bottomOffset) + LEFT_SPACE + this.leftOffset;
};

/**
 * Set a line option
 *
 * @param line the line number
 * @param opName the option name (Ln or Rn for n in [1;20]
 * @param opValue the option value
 * @param replace whether to replace values that already exist
 */
DATFile.prototype.setLineOption = function(line, opName, opValue, replace) {
  console.assert(line < this.height, 'Invalid line');
  let opNum = parseInt(opName.substr(1));
  let opChar = opName[0].toLowerCase();
  console.assert(opNum > 0 && opNum <= 20, 'Invalid option');
  console.assert(opChar == 'l' || opChar == 'r', 'Invalid option');
  let opPos = -1;
  if(opName[0].toLowerCase() == 'l'){
    let leftOptionBase = this.getLineIndex(line) - 5;
    opPos = leftOptionBase - 2 * opNum;
    if(opNum > 1 || this.data[opPos + 1] == 0)
      this.data[opPos + 1] = opNum;
  } else if(opName[0].toLowerCase() == 'r'){
    let rightOptionBase = this.getLineIndex(line) + this.width + 4;
    opPos = rightOptionBase + 2 * opNum;
    if(opNum > 1 || this.data[opPos - 1] == 0)
      this.data[opPos - 1] = opNum;
  } else {
    throw "Invalid option";
  }
  let oldValue = this.data[opPos] || 0;
  if(oldValue === 0 || replace)
    this.data[opPos] = opValue;
};

/**
 * Return a line option
 *
 * @param line the line number
 * @param opName the option name
 * @param defaultValue the default value to use if undefined (default to 0)
 * @return the current option value
 */
DATFile.prototype.getLineOption = function(line, opName, defaultValue){
  if(!defaultValue)
    defaultValue = 0;
  console.assert(line < this.height, 'Invalid line');
  let opNum = parseInt(opName.substr(1));
  let opChar = opName[0].toLowerCase();
  console.assert(opNum > 0 && opNum <= 20, 'Invalid option');
  console.assert(opChar == 'l' || opChar == 'r', 'Invalid option');
  let opPos = -1;
  if(opName[0].toLowerCase() == 'l'){
    let leftOptionBase = this.getLineIndex(line) - 5;
    opPos = leftOptionBase - 2 * opNum;
  } else if(opName[0].toLowerCase() == 'r'){
    let rightOptionBase = this.getLineIndex(line) + this.width + 4;
    opPos = rightOptionBase + 2 * opNum;
  } else {
    throw "Invalid option";
  }
  return this.data[opPos] || defaultValue;
};

/**
 * Return an object containing all the options of a line
 *
 * @param line the line to get the options of
 * @return { Lxx: v, ... }
 */
DATFile.prototype.getLineOptions = function(line){
  let options = {};
  for(let side of [ 'R', 'L' ]){
    for(let i = 1; i <= 20; ++i){
      let opName = side + i;
      let val = this.getLineOption(line, opName);
      if(val)
        options[opName] = val;
    }
  }
  return options;
};

/**
 * Update a set of line options
 *
 * @param line the line to update the options
 * @param options an object mapping option name to value
 * @param replace whether to replace values that already exist
 */
DATFile.prototype.setLineOptions = function(line, options, replace){
  for(let o = 1; o <= 20; ++o){
    let op = ['R', 'L'];
    for(let i = 0; i < op.length; ++i){
      let opName = op[i] + o.toString();
      if(opName in options)
        this.setLineOption(line, opName, options[opName], replace);
      else if(opName.toLowerCase() in options)
        this.setLineOption(line, opName, options[opName.toLowerCase()], replace);
      else
        this.setLineOption(line, opName, 0, false); // write option bar, but do not replace (since not provided as option)
    }
  }
};

/**
 * Read line direction
 *
 * /!\ Important: the codes for left move / right move
 * are opposite to the line direction codes (for some weird reason),
 * but we use the constant for the move instruction => we must invert the direction
 *
 * @param line the line to read the direction for
 * @param asString whether to return direction as a string (false by default)
 * @return the line direction (as a number or string)
 */
DATFile.prototype.getLineDirection = function(line, asString){
  const leftOptionBase = this.getLineIndex(line) - 5;
  const rightOptionBase = this.getLineIndex(line) + this.width + 4;
  const leftValue = this.data[leftOptionBase - 1]   || NONE;
  const rightValue = this.data[rightOptionBase + 1] || NONE;
  // different cases
  if(leftValue != rightValue){
    return asString ? 'uneven' : NONE;
  } else if(asString){
    switch(INV_DIR[leftValue]){
      case LEFT: return 'left';
      case RIGHT: return 'right';
      case TRANSFER: return 'transfer';
      case 0: return 'undefined';
      default: return 'invalid';
    }
  } else {
    return INV_DIR[leftValue];
  }
};

/**
 * Set a line direction
 *
 * @param line the line to modify
 * @param dir the direction (from 1,6,7 or 'left', 'right', 'transfer')
 */
DATFile.prototype.setLineDirection = function(line, dir){
  // if direction is a string => convert into number
  if(typeof dir == 'string'){
    dir = dir.toLowerCase();
    // string direction conversion
    if(dir == 'left')
      dir = LEFT;
    else if(dir == 'right')
      dir = RIGHT;
    else if(dir == 'transfer')
      dir = TRANSFER;
    else
      throw "Invalid line direction " + dir;
  }

  // checking direction value
  console.assert(line < this.height, 'Invalid line ' + line);
  console.assert([LEFT, RIGHT, TRANSFER].includes(dir), 'Invalid direction ' + dir);
  
  let leftOptionBase = this.getLineIndex(line) - 5;
  let rightOptionBase = this.getLineIndex(line) + this.width + 4;
  
  // /!\ the line code is the opposite direction from the pattern code!
  this.data[leftOptionBase - 1] = this.data[rightOptionBase + 1] = INV_DIR[dir];
};

/**
 * Update the line direction of all lines assuming a start from left
 */
DATFile.prototype.setLineDirections = function(){
  // automatically define direction lines (from values onto lines)
  let dir = RIGHT; // carrier starts from the left to the right
  for(let line = 0; line < this.height; ++line){
    let R5 = this.getLineOption(line, 'R5');
    switch(R5){
      case 1:  // knit cancel
      case 11: // knit cancel + 7p racking
        this.setLineDirection(line, TRANSFER);
        continue; // do not reverse after pass (since both ways)
      case 2: // carriage move
        dir = INV_DIR[dir]; // reverse
        // dir == 'left' ? 'right' : 'left'; // reverse
        this.setLineDirection(line, dir);
        break;
      case LEFT:
      case RIGHT: // independent carrier movement
        dir = R5;
        this.setLineDirection(line, dir);
        break;
      default:
        console.assert(R5 == NONE, 'Invalid R5 value ' + R5);
        this.setLineDirection(line, dir);
        break;
    }
    dir = INV_DIR[dir];
    // == 'left' ? 'right' : 'left'; // reverse for next line
  }
};

/**
 * Compute the expected direction for a line
 * using information from previous lines
 *
 * @param line the line to compute the expected direction of
 * @return the expected carrier direction for that line
 */
DATFile.prototype.computeDirectionFor = function(line){
  for(let i = line - 1; i >= 0; --i){
    let dir = this.getLineDirection(i);
    if(dir == NONE)
      throw "Directions haven't been computed correctly up to now";
    // reverse direction if left/right
    if(dir == LEFT || dir == RIGHT)
      return INV_DIR[dir];
    // else, skip (transfer => no direction change)
  }
  return RIGHT; // initially going right
};

/**
 * Set the carrier position on a line
 *
 * @param line the line to update
 * @param clear whether to clear previous carrier positions
 */
DATFile.prototype.setCarrierPosition = function(line, clear){
  console.assert(line !== undefined, 'Use setCarrierPositions() if applying to all lines, else use line number');
  let dir = this.getLineDirection(line);
  console.assert([LEFT, RIGHT, TRANSFER].includes(dir), 'You must set line directions before setting carrier position');
  
  // clearing
  let left = this.getLineIndex(line);
  const CARRIER_POS = 13;
  if(clear){
    for(let i = 0; i < this.width + 2; ++i){
      if(this.data[left - 1 + i] == CARRIER_POS)
        this.data[left - 1 + i] = 0;
    }
  }

  if(dir == 'transfer')
    return;
  
  // check boundaries
  let idxMin = this.width - 1;
  let idxMax = 0;
  for(let i = 0; i < this.width; ++i){
    let instr = this.data[left + i];
    if(instr && instr != 99){
      if(idxMin > i)
        idxMin = i;
      if(idxMax < i)
        idxMax = i;
    }
  }
  // note: the boundaries must have changed (at least one)
  console.assert(idxMin != this.width - 1 || idxMax != 0, 'Line ' + line + ' has no instruction');

  // set boundary instructions
  this.data[left + idxMin - 1] = this.data[left + idxMax + 1] = CARRIER_POS;
};

/**
 * Introduce carrier positions
 *
 * @param clear whether to remove previous carrier positions
 */
DATFile.prototype.setCarrierPositions = function(clear){
  for(let line = 0; line < this.height; ++line)
    this.setCarrierPosition(line, clear);
};

/**
 * Set RAW pixel value
 *
 * @param y pixel row
 * @param x pixel column
 * @param value pixel value
 */
DATFile.prototype.setPixel = function(y, x, value){
  console.assert(y >= 0 && y < this.fullHeight && x >= 0 && x < this.fullWidth, 'Out-of-bound raw write access y=' + y + ', x=' + x);
  this.data[this.fullWidth * y + x] = value;
};

/**
 * Get RAW pixel value
 *
 * @param y pixel row
 * @param x pixel column
 * @return pixel value
 */
DATFile.prototype.getPixel = function(y, x){
  console.assert(y >= 0 && y < this.fullHeight && x >= 0 && x < this.fullWidth, 'Out-of-bound raw read access y=' + y + ', x=' + x);
  return this.data[this.fullWidth * y + x];
};

/**
 * Get a RAW pixel block
 *
 * @param y0 start y
 * @param x0 start x
 * @param y1 end y (included)
 * @param x1 end x (included)
 * @return a 1-d array with coordinates [(y0,x0), (y0,x0+dx) ... (y1,x1-dx), (y1,x1)]
 */
DATFile.prototype.getPixelBlock = function(y0, x0, y1, x1, dy, dx){
  if(!dy) dy = 1;
  if(!dx) dx = 1;
  console.assert(dx >= 1 && dy >= 1, 'Invalid dx/dy values ', dx, dy);
  let data = [];
  for(let y = y0; y <= y1; y += dy){
    for(let x = x0; x <= x1; x += dx){
      data.push(this.getPixel(y, x));
    }
  }
  return data;
};

/**
 * Set an instruction value
 *
 * @param line the instruction line
 * @param col the instruction column
 * @param value the instruction
 */
DATFile.prototype.setValue = function(line, col, value){
  console.assert(line >= 0 && line < this.height && col >= 0 && col < this.width, 'Out-of-bound access');
  this.data[this.getLineIndex(line) + col] = value;
};

/**
 * Get the current instruction at a given position
 *
 * @param line instruction line
 * @param col instruction column
 * @return the current instruction at the given position
 */
DATFile.prototype.getValue = function(line, col){
  console.assert(line >= 0 && line < this.height && col >= 0 && col < this.width, 'Out-of-bound access');
  return this.data[this.getLineIndex(line) + col];
};

/**
 * Fill a line with one instruction
 *
 * @param line the line number
 * @param value the instruction to fill
 * @param options the set of options to use
 * @param direction the direction to use
 * @param newline whether to create a newline
 */
DATFile.prototype.setLine = function(line, value, options, direction, newline) {
  if(newline === undefined)
    newline = this.streaming;
  console.assert(line >= 0 && line < this.height, 'Invalid line ' + line + ' of ' + this.height);
  // create line if needed
  if(newline)
    this.newLine();
  // write line information
  for(let c = 0; c < this.width; ++c)
    this.setValue(line, c, value);
  // write option information
  this.setLineOptions(line, options || {});
  // write direction information
  if(direction)
    this.setLineDirection(line, direction);
};

/**
 * Helper to get a copy of the current instructions of a line
 *
 * @param line the line to retrieve the instructions of
 * @return a list of instructions
 */
DATFile.prototype.getLine = function(line){
  console.assert(line >= 0 && line < this.height, 'Invalid line ' + line + ' of ' + this.height);
  let from = this.getLineIndex(line);
  return this.data.slice(from, from + this.width);
};

/**
 * Fill a line with one segment of instructions
 *
 * @param line the line number
 * @param offset the segment offset
 * @param values the segment (must be at most as wide as a line)
 * @param options the set of options to use
 * @param direction the direction to use
 * @param newline whether to create a newline
 */
DATFile.prototype.setSegment = function(line, offset, values, options, direction, newline) {
  if(newline === undefined)
    newline = this.streaming;
  console.assert(line >= 0 && line < this.height, 'Invalid line ' + line + ' of ' + this.height);
  console.assert(offset + values.length <= this.width, 'Segment goes out of bounds');
  // create line if needed
  if(newline)
    this.newLine();
  // write line information
  for(let i = 0; i < values.length; ++i)
    this.setValue(line, offset+i, values[i]);
  // write option information
  this.setLineOptions(line, options || {});
  // write direction information
  if(direction)
    this.setLineDirection(line, direction);
};

/**
 * Insert a new yarn carrier
 *
 * @param line line to insert the yarn at
 * @param carrier the yarn carrier index
 * @param manual whether to use manual insertion and release
 * @param noHold whether to not hold the yarn (holds by default)
 */
DATFile.prototype.insertYarn = function(line, carrier, manual, noHold) {
  if(noHold)
    this.setLineOptions(line, { R15: 10 + (manual ? 0 : carrier) });
  else
    this.setLineOptions(line, { R10: carrier, R15: 10 + (manual ? 0 : carrier) });
};

/**
 * Release the yarn from the inserting unit
 *
 * @param line the line to release at
 */
DATFile.prototype.releaseYarn = function(line){
  this.setLineOption(line, 'R15', 90);
};

/**
 * Remove a yarn carrier
 *
 * @param line the line to remove the yarn from
 * @param carrier the yarn carrier index
 * @param manual whether to use manual removal
 * @param noHold whether to not hold the yarn (holds by default)
 */
DATFile.prototype.removeYarn = function(line, carrier, manual, noHold){
  if(noHold)
    this.setLineOptions(line, { R15: 20 + (manual ? 0 : carrier) });
  else
    this.setLineOptions(line, { R10: 100 + carrier, R15: 20 + (manual ? 0 : carrier) });
};

/**
 * Move yarn carrier in
 *
 * @param line the line to move carrier back in
 */
DATFile.prototype.yarnIn = function(line){
  this.setLineOption(line, 'R11', 32);
};

/**
 * Move yarn carrier out
 *
 * @param line the line to move carrier away at
 */
DATFile.prototype.yarnOut = function(line){
  this.setLineOption(line, 'R11', 31);
};

/**
 * Ensure the DSCS state is on
 *
 * @param line the line to start at
 */
DATFile.prototype.startDSCS = function(line){
  this.setDSCSState(line, 1);
};

/**
 * Ensure the DSCS state is off
 *
 * @param line the line to end at
 */
DATFile.prototype.stopDSCS = function(line){
  this.setDSCSState(line, 0);
};

/**
 * Toggle the DSCS state at a given line
 *
 * @param line the line to toggle at
 */
DATFile.prototype.toggleDSCS = function(line){
  if(line === undefined)
    line = this.current;
  this.setLineOption(line, 'L9', 1);
};

/**
 * Set the expected DSCS state
 *
 * @param line the line to set it at
 * @param state the state (0, 1 or a custom state)
 */
DATFile.prototype.setDSCSState = function(line, state){
  if(line === undefined)
    line = this.current;
  switch(state || 0){

    // off
    case 0:
      if(this.getDSCSState(line))
        this.toggleDSCS(line);
      break;

    // on
    case 1:
      if(!this.getDSCSState(line))
        this.toggleDSCS(line);
      break;

    // special state
    default:
      this.setLineOption(line, 'L9', state);
      break;
  }
};

/**
 * Return the current DSCS state
 *
 * @param line the line to query the state at
 * @return a state (likely 0 or 1)
 */
DATFile.prototype.getDSCSState = function(line){
  if(line === undefined)
    line = this.current;
  let state = 0;
  for(let i = 0; i <= line; ++i){
    const dscs = this.getLineOption(i, 'L9') || 0;
    switch(dscs){
      case 0:
        continue;
      case 1:
        console.assert([0, 1].includes(state), 'Unsupported mixing');
        // toggle state if in {0, 1}
        if(state == 1 || state == 0)
          state = 1 - state;
        // else unsupported for now
        break;
      default:
        state = dscs;
        break;
    }
  }
  return state;
};

/**
 * Write the preamble (bed clearing in three lines)
 *
 * @param newline whether to allocate the preamble lines
 */
DATFile.prototype.writePreamble = function(newline){
  if(newline === undefined)
    newline = this.streaming;
  this.setLine(0, 216, { R3: 255, R9: 1 }, 'right', newline);
  this.setLine(1, 51,  { R3: 255, R9: 1 }, 'left',  newline);
  this.setLine(2, 52,  { R3: 255, R9: 1 }, 'right', newline);
};

/**
 * Write the postamble (bed clearing in three lines, closing line and position)
 *
 * @param newline whether to allocate the postamble lines
 */
DATFile.prototype.writePostamble = function(newline){
  if(newline === undefined)
    newline = this.streaming;

  let line0 = newline ? this.height - 1 : this.height - 3;
  let line = (function(startLine){
    let idx = startLine;
    return function(){
      return idx++;
    };
  })(line0);

  // update directions first
  this.setLineDirections();

  // R5:2 => carriage move (if ending on wrong side)
  let reset = 0;
  for(let l = line0 - 1; l >= 0; --l){
    let dir = this.getLineDirection(l);
    if(dir == LEFT || dir == RIGHT){
      // we can set the value of reset
      reset = dir == 'left' ? 2 : 0;
      break;
    }
  }
  
  // bed clearing fixed data
  this.setLine(line(), 51, { R3: 255, R5: reset, R7: 11, R9: 1 }, 'left',  newline);
  this.setLine(line(), 52, { R3: 255, R9: 1 },            'right', newline);
  this.setLine(line(), 51, { R3: 255, R9: 1 }, 'left',  newline);
  this.setLine(line(), 52, { R3: 255, R9: 1 },            'right', newline);
  this.setLine(line(), 3,  { R3: 255, R9: 1 },    'left'); // no newline for the last one (since it's the end)

  // clearing extra lines
  if(newline && this.height != line0 + 5){
    this.height = line0 + 5;
    this.fullHeight = BOTTOM_SPACE + this.height + TOP_SPACE;
  }

  // ending line
  line(); // empty line
  let endbar = line();
  for(let i = 0; i < this.width + 10; ++i)
    this.data[this.getLineIndex(endbar) - 5 + i] = 1;

  // set position
  this.writePosition();
};

/**
 * Write the position information
 */
DATFile.prototype.writePosition = function(){
  let line = this.fullHeight - TOP_SPACE + 1;
  let position = 0;
  let npos = this.needlePos + '';
  switch(npos.toLowerCase()){
    case 'left':
      position = 1;
      break;
    case 'center':
      position = Math.round((this.maxWidth - this.width) / 2);
      break;
    case 'right':
      position = 0; // special information left to compiler
      break;
    default:
      if(parseInt(this.needlePos) == this.needlePos){
        console.assert(this.needlePos >= 0 && this.needlePos + this.width <= this.maxWidth, 'Out-of-bed');
        position = this.needlePos;
      } else {
        throw "Invalid needle position";
      }
  }
  this.data[this.getLineIndex(line - BOTTOM_SPACE + 0) - 7] = position % 100;
  this.data[this.getLineIndex(line - BOTTOM_SPACE + 1) - 7] = Math.floor(position / 100);
};

/**
 * Pad a grid with margins
 *
 * @param data the grid 1d array
 * @param w grid width
 * @param h grid height
 * @param margin scalar or array [top, right, bot, left]
 * @return padded data
 */
DATFile.pad = function(data, w, h, margin){
  let top, right, bot, left;
  if(Array.isArray(margin)){
    top = margin[0] || 0;
    right = margin[1] || 0;
    bot = margin[2] || 0;
    left = margin[3] || 0;
  } else {
    top = right = bot = left = margin;
  }
  let width = w + left + right;
  let height = h + top + bot;
  let newData = new Array(width * height);
  for(let i = bot * width + left, j = 0, n = w * h; j < n; i += width, j += w){
    for(let col = 0; col < w; ++col)
      newData[i + col] = data[j + col];
  }
  return newData;
};

/**
 * Encode data into RLE format
 *
 * @param data the data to encode
 * @param w the width of the grid
 * @param h the height of the grid
 * @return the RL-encoded array
 * @reference based on work from Jim McCann <jmccann@cs.cmu.edu>
 * @see https://github.com/textiles-lab
 */
DATFile.RLEncode = function(data, w, h){

  // run length encode index-length pairs per row of the data
  let indexLength = [];
  let totalCount = 0;
  for( let y = 0; y < h; y++) {
    
    // checking entry value
    let index = data[ y * w ] || 0; // first row entry
    console.assert(index < 256 && index >= 0, "Indexing into 256 size palette: " + index);
    
    // run-length encoding
    let len = 0;
    for( let x = 0; x < w; x++) {
      let next = data[y * w + x] || 0;
      len = ( index == next ? len + 1 : len );
      console.assert(len <= w, "Length cannot be greater than width.");
      if( (next != index) || (len == 0xff) || (x+1 == w)){
        indexLength.push(index);
        indexLength.push(len);
        totalCount += len;
        // catch edge case of single change at end of line
        if( next != index && x+1 == w){
          indexLength.push(next);
          indexLength.push(1);
          totalCount += 1;
        }
        index = next;
        if(len == 0xff){ 
          len = 0;
        } else {
          len = 1;
        }
      }
    }
    console.assert(len == 1 || len == 0, "Run length encoding is per row, should have pushed at the end of a row.");
  }

  // checking count
  console.assert(totalCount == w * h, "Total length (" + totalCount + ") and data size (" + w + " x " + h + " = " + (w*h) + ") are different.");

  return indexLength;

};

/**
 * Convert the current DAT data to a file buffer content
 *
 * @param margin extra margin for data
 * @param callback function to retrieve the result as first argument
 * @return the DAT buffer
 * @reference based on work from Jim McCann <jmccann@cs.cmu.edu>
 * @see https://github.com/textiles-lab
 */
DATFile.prototype.toBuffer = function(margin, callback){
  // function with no margin
  if(margin && typeof margin == 'function'){
    callback = margin;
    margin = 0;
  }

  // add margin
  let data = this.data;
  let width = this.fullWidth;
  let height = this.fullHeight;
  if(margin){
    data = DATFile.pad(data, width, height, margin);
    // adjust width and height
    if(Array.isArray(margin)){
      height += (margin[0] || 0) + (margin[2] || 0);
      width  += (margin[1] || 0) + (margin[3] || 0);
    } else {
      height += 2 * margin;
      width  += 2 * margin;
    }
  }

  // RL encoding
  let indexLength = DATFile.RLEncode(data, width, height);

  // get palette
  let palette = this.getDefaultPalette();

  // build the buffer
  let buffer = new ArrayBuffer(0x600 + indexLength.length);

  // set header like information in little-endian format
  // uintXarrays set data in platform byte order which should be little-endian
  // but let's just use DataView and explicitly set it

  let headerData = new DataView(buffer, 0, 0x200);
  // x-min
  headerData.setUint16(0, 0, true);
  // y-min
  headerData.setUint16(2, 0, true);
  // x-max
  headerData.setUint16(4, width  - 1, true);
  // y-max
  headerData.setUint16(6, height - 1, true);
  // magic numbers, always 1000
  headerData.setUint16(8,  1000, true);
  headerData.setUint16(16, 1000, true);

  // palette begins at offset 0x200
  let paletteData = new Uint8Array(buffer, 0x200, 3*256);
  paletteData.set(palette);

  // actual data is in  byte pairs, index and length; now that we know the length
  let indexLengthData = new Uint8Array(buffer, 0x600, indexLength.length);
  indexLengthData.set(indexLength);

  if(callback)
    callback(buffer);
  return buffer;
};

/**
 * Write the current DAT data to disk
 *
 * @param filename the name of the DAT file (default to output.dat)
 */
DATFile.prototype.write = function(filename){
  let fname = filename || this.filename;
  
  // write dat file
  let array = new Uint8Array(this.toBuffer());
  try {
    fs.writeFileSync(fname, Buffer.from(array));
  } catch(e) {
    fs.writeFileSync(fname, new Buffer(array)); // older deprecated method
  }
};

/**
 * Read the content of a DAT file
 *
 * @param input a file name or buffer object
 * @reference based on work from Jim McCann <jmccann@cs.cmu.edu>
 * @see https://github.com/textiles-lab
 */
DATFile.prototype.read = function(input, verbose){
  // read DAT file
  let buffer = null;
  if(!input || typeof input == 'string')
    buffer = fs.readFileSync(input || this.filename);
  else
    buffer = input;

  let getU16 = function(byteIdx){
    return buffer.readInt16LE(byteIdx);
  };
  let minX = getU16(0x0); // header.getUint16(0x0, true);
  let minY = getU16(0x2);
  let maxX = getU16(0x4); 
  let maxY = getU16(0x6);
  
  let magic1 = getU16(0x8);
  let magic2 = getU16(0x10);
  
  if(verbose){
    console.log('x: ' + minX + ' -> ' + maxX);
    console.log('y: ' + minY + ' -> ' + maxY);
    console.log('magic: ' + magic1 + ' ' + magic2);
  }
  if(magic1 != 1000 || magic2 != 1000){
    console.error('Invalid magic numbers: ' + magic1 + ' and ' + magic2);
  }
  
  // compute workspace size
  let width  = maxX - minX + 1;
  let height = maxY - minY + 1;
  if(verbose){
    console.log('width: ' + width);
    console.log('height: ' + height);
  }
  // allocate internal buffer
  this.allocatePixels(width, height);

  // data = array of (index, length) pairs
  let length = buffer.length - 0x600;
  let pointer = 0;
  for(let i = 0; i < length; i += 2){
    let idx = buffer[0x600+i];
    let len = buffer[0x601+i];
    // store len-times
    for(let c = 0; c < len; ++c, ++pointer){
      console.assert(pointer < this.fullWidth * this.fullHeight, 'Out-of-bound buffer transfer');
      this.data[pointer] = idx;
    }
  }
};

/**
 * Retrieve the default palette as a uint8 array of 0x300 values (R=0x100|G=0x100|B=0x100)
 *
 * @param imgOrder whether to export in image order (true) or DAT order (false)
 * @return the 0x300-long palette array
 * @reference based on work from Jim McCann <jmccann@cs.cmu.edu>
 * @see https://github.com/textiles-lab
 */
DATFile.prototype.getDefaultPalette = DATFile.getDefaultPalette = function(imgOrder){
  // copied palette from argyle example pattern using DAT viewer
  let paletteStr = 
    "ff 00 ff 00 ff 00 ff 00 6c 4a ff b4 99 90 80 cf 52 51 eb 00 fc b2 fc fc fc fc 64 d8 eb a0 90 73 9d 73 d8 eb ff b4 ac d7 d8 7f d8 90 ca d8 ae bc 80 9f ff dc fc c0 d8 fc 90 ff fd b4 00 a0 32 32 00 35 d8 d8 a8 c0 ff 99 b7 00 e2 c5 90 c0 90 90 4a 00 90 6d 00 00 66 33 85 99 78 ca b4 90 7d ff ff ff 7f 69 fa 81 fc ac 7f b2 b4 b4 b4 d4 ff 90 ff c0 c0 73 d8 a9 bf b4 ff 90 d8 b2 aa 00 d8 00 fb 90 81 9d 37 ac dd bf b9 3f ef d7 de fd fe 73 2f 8d fb ff fe ed 06 f5 ea ed ad 3d fc fa ef fd 66 8d 7f 7a 5f 79 9b 71 ff ee a8 ff 9f db f5 ff cd f3 e0 fe c8 79 73 1f bf e5 f3 f6 e0 de f0 cc 4b 64 40 a1 f7 1a e0 67 ff 64 f5 3f 97 ef 14 96 d7 67 b7 ee ba ea 6c bd 26 4e 64 2f bf 9f 7f f3 aa ff e6 bf 57 eb 06 fe 4f ed 6a ef 62 b7 dd cf 66 6b b2 7a 5a f7 9c 4c 96 9d 00 00 6e c8 00 64 00 00 ff ff 00 00 ff ff 24 89 67 b4 99 6c 80 90 91 ff eb 7c b4 76 6c 94 b4 d8 c8 90 ac 66 d8 73 7f b2 d8 eb 00 b4 ac c3 48 00 d8 6c a7 b4 8d 9a 60 7f 90 76 fc ff fc fc ff 90 eb 90 ff ff ca e9 d5 af 6c 6c 54 60 ff 66 bc a0 c5 ae cf ff b4 d8 89 70 c0 a5 99 66 c1 ad 7a d6 30 28 6c 48 8f 00 99 66 00 3f a3 64 d8 eb 7f b2 6c 90 d8 95 bf 6c cf cf 90 b2 d8 e5 6a d8 dd d8 b4 73 00 00 9d 96 fd 65 df 5a 9d ac f3 df f7 6e ff db ff fb fb ab 31 c7 fa af 6a af 03 9d fe ea 0c 9f de a7 f5 7d 00 c7 ff 67 bf 7f 7f 87 fc ce bf 2f 6f be ba fd f2 5f 2d df c8 7f 5b b5 77 6f 8f db 92 7e f0 5f ff 9d 40 ba f7 ec 6d fb 64 64 96 e3 c7 f7 d3 ff af 7f f5 f6 73 f7 b2 5a 5f 88 89 b7 bc fd 7f e9 7f 7e 2f fa 7c f7 03 a5 c7 ea fb 8d ff ff 79 5b 00 e7 8d 67 b9 ec 59 f7 00 bd 96 af 00 00 7d 64 00 00 00 00 ff ff ff ff 90 99 bd d8 99 b4 ff c0 db de 24 91 6c b2 48 63 fc fc c8 fc eb 00 48 b2 01 73 48 ac a0 6c eb e1 90 7f fc d8 e1 d8 f5 46 ff ff 90 75 b4 90 48 90 c0 cf c7 90 ff ff e9 e9 00 ed b4 d8 b4 b4 ff ff bc a0 b2 b7 c0 cf fc fc 99 99 cf b4 ff ff ff ff 03 ff 9c 91 d8 b4 a5 8f d2 bb 00 24 b9 0c 6c ac 00 73 6c 48 d8 95 bf 6c 90 90 cf b2 b4 e7 69 90 ad fc 6c 73 00 7f 49 00 fe fd a5 6f 7f ff 7b be ab 11 67 ff b9 55 9d 7f fb de 7f 7f 7f fb f0 93 fe fb eb bf ef 5d f7 fc 8a de ff 96 3a bd df bb f8 3d b0 cf 9e fe 5f fd f3 d9 ff 93 c8 bd aa 37 fd 81 7f be ff 7f f0 91 4b 4c 40 4b 67 ce ff a9 7d ff 64 d3 6f f7 b4 f7 ad cf fc e9 cd 7f 81 af 64 f7 51 f5 a4 7d df 3f cf f7 fd f9 7f df f0 4d 5f fb ff fb 4f df a9 f0 8a 45 ba 96 fc bd 09 b7 00 f2 00 00 00 00 00 64";
  // remove spaces
  paletteStr = paletteStr.replace(/\s/g, '');
  // sanity check
  console.assert( paletteStr.length/2 === 3*256 , "Expected palette string to hold 3*256*2 characters" );

  // generate palette from template above
  let palette = new Uint8Array(3*256); // R256G256B256

  for( let i = 0; i < palette.length; i++) {
    let idx = i;
    if(imgOrder){
      if(i % 2 == 0)
        idx = i + 1;
      else
        idx = i - 1;
    }
    palette[idx] = parseInt(paletteStr.substr(i*2,2), 16); // parse as hex
  }

  return palette;
};

/**
 * Locate the data within a file
 *
 * @param centerY guess of center Y
 * @param centerX guess of center X
 * @return whether a data layout was found
 */
DATFile.prototype.locate = function(centerY, centerX){
  // default center argument
  if(centerY === undefined)
    centerY = Math.floor(this.fullHeight / 2);
  if(centerX === undefined)
    centerX = Math.floor(this.fullWidth / 2);

  // find left/right range
  let left = this.locateLeftOptionBase(centerY, centerX);
  if(!left)
    return false;
  let right = this.locateRightOptionBase(centerY, centerX);
  if(!right)
    return false;

  // content width
  // 1) left  = getLineIndex - 5
  // 2) right = getLineIndex + width + 4
  // => width = (right-4) - (left+5)
  this.width = right - left - 9;
  if(this.width <= 0)
    return false;

  // left offset
  // 1) left = getLineIndex - 5
  // 2) getLineIndex % fullWidth = LEFT_SPACE + leftOffset
  // => leftOffset = left + 5 - LEFT_SPACE
  this.leftOffset = left + 5 - LEFT_SPACE;

  // find top/bottom range
  let bottom = centerY;
  while(bottom - 1 > BOTTOM_SPACE
     && this.isLeftSideValid(bottom - 1, left)
     && this.isRightSideValid(bottom - 1, right)){
    // bottom - 1 is valid => go there
    --bottom;
  }
  let top = centerY;
  while(top + 1 <= this.fullHeight - TOP_SPACE
     && this.isLeftSideValid(top + 1, left)
     && this.isRightSideValid(top + 1, right)){
    ++top;
  }

  // content height
  // 1) top = lastLineIndex
  // 2) bot = firstLineIndex
  // 3) height = lastLineIndex - firstLineIndex + 1
  // => height = top - bot + 1
  this.height = top - bottom + 1;

  // bottom offset
  // 1) bottom = firstLineIndex = BOTTOM_SPACE + bottomOffset
  // => bottomOffset = bottom - BOTTOM_SPACE
  this.bottomOffset = bottom - BOTTOM_SPACE;

  return true;
};
const MAX_INVALID = 3; // L1 | L19 | ??? or R1 | R2 | ???
DATFile.prototype.isLeftSideValid = function(y, left, maxInvalid){
  if(maxInvalid === undefined)
    maxInvalid = MAX_INVALID;
  // leftOptionBase = this.getLineIndex(line) - 5;
  // opPos = leftOptionBase - 2 * opNum
  // this.data[opPos + 1] = opNum;
  let numInvalid = 0;
  for(let i = 0; i <= 20 && numInvalid <= MAX_INVALID; ++i){
    let opPos = y * this.fullWidth + left - 2 * i;
    if(this.data[opPos + 1] != i)
      ++numInvalid;
  }
  return numInvalid <= maxInvalid;
};
DATFile.prototype.locateLeftOptionBase = function(y, centerX) {
  for(let left = centerX; left >= 40; --left){
    if(this.isLeftSideValid(y, left))
      return left;
  }
  return false;
};
DATFile.prototype.isRightSideValid = function(y, right, maxInvalid){
  if(maxInvalid === undefined)
    maxInvalid = MAX_INVALID;
  // rightOptionBase = this.getLineIndex(line) + this.width + 4;
  // opPos = rightOptionBase + 2 * opNum;
  // this.data[opPos - 1] = opNum;
  let numInvalid = 0;
  for(let i = 0; i <= 20 && numInvalid <= MAX_INVALID; ++i){
    let opPos = y * this.fullWidth + right + 2 * i;
    if(this.data[opPos - 1] != i)
      ++numInvalid;
  }
  return numInvalid <= maxInvalid;
};
DATFile.prototype.locateRightOptionBase = function(y, centerX) {
  for(let right = centerX; RIGHT < this.fullWidth - 40; ++right){
      if(this.isRightSideValid(y, right))
        return right;
  }
  return false;

};

module.exports = Object.assign(DATFile, {
  LEFT, RIGHT, TRANSFER
});
