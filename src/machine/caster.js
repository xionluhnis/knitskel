// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// --- imports
const Code = require('./code.js');

// --- constants
const C = {
  // flags
  SKIP_EMPTY:     1,
  MIRROR_LEFT:    2,
  REVERSE_LEFT:   2,
  MIRROR_RIGHT:   4,
  REVERSE_RIGHT:  4,
  ONE_SIDED:      6,
  LINK_PROCESS:   8,
  AUTO_MOVE:      16,
  IGNORE_BED:     32,
  // negative flags
  WRAP_LEFT:      -2,
  WRAP_RIGHT:     -4,
  TWO_SIDED:      -6,
  USER_MOVE:      -16,
  // transfer flags
  FRONT_TO_BACK:  1,
  ON_BACK:        1,
  BACK_TO_FRONT:  2,
  ON_FRONT:       2,
  SAME_BED:       4,
  BACK_TO_BACK:   5,
  FRONT_TO_FRONT: 6,
  KNIT_BEFORE:    8,
  KNIT_AFTER:     16,
  USING_SLIDERS:  32,

  // conversions
  CAST_TYPE: {
    [Code.KNIT]: {
      'front': Code.KNIT,
      'back':  Code.PURL
    },
    [Code.PURL]: {
      'front': Code.PURL,
      'back':  Code.KNIT
    },
    [Code.FRONT_KNIT]: {
      'front': Code.FRONT_KNIT,
      'back':  Code.BACK_KNIT
    },
    [Code.FRONT_BACK_KNIT]: {
      'front': Code.FRONT_BACK_KNIT,
      'back':  Code.FRONT_BACK_KNIT
    },
    [Code.MISS]: {
      'front': Code.MISS,
      'back':  Code.MISS
    },
    [Code.FRONT_MISS]: {
      'front': Code.FRONT_MISS,
      'back':  Code.BACK_MISS
    },
    [Code.TUCK]: {
      'front': Code.TUCK,
      'back':  Code.REVERSE_TUCK
    },
    [Code.FRONT_TUCK]: {
      'front': Code.FRONT_TUCK,
      'back':  Code.BACK_TUCK
    },
    [Code.FRONT_KNIT_KICKBACK]: {
      'front': Code.FRONT_KNIT_KICKBACK,
      'back':  Code.BACK_KNIT_KICKBACK
    },
  },
  // bed state updates
  // 0 => no change
  // 1 => change on current side
  // 2 => change on both sides
  // -1 => change on opposite side
  CAST_SIDE: {
    [Code.KNIT]: 1,
    [Code.PURL]: -1,
    [Code.FRONT_KNIT]: 1,
    [Code.FRONT_BACK_KNIT]: 2,
    [Code.MISS]: 0,
    [Code.FRONT_MISS]: 0,
    [Code.TUCK]: 1,
    [Code.FRONT_TUCK]: 1,
    [Code.FRONT_KNIT_KICKBACK]: 1
  },
  // default info
  LEFT: Code.LEFT,
  RIGHT: Code.RIGHT,
  TRANSFER: Code.TRANSFER,
  INV_DIR: Code.INV_DIR,
  OTHER_SIDE: Code.OTHER_SIDE
};

/**
 * Creates a yarn caster
 *
 * @param dat the DATFile to use
 * @param bed the needle bed to use (will be modified)
 * @param args optional named arguments
 */
function Caster(dat, bed, args){
  if(!args) args = {};
  // datfile and options
  this.dat   = dat;
  this.carrier = args.carrier || 1;
  this.options = {
    [Code.CARRIER]: this.carrier,
    [Code.TENSION]: 5
  };
  // bed and range
  this.bed   = bed;
  this.left  = args.left  || 0;
  this.right = args.right || (this.bed.width || this.bed.length) - 1;
  // current location and direction
  this.side  = args.side  || 'front';
  if(typeof this.side != 'string')
    this.side = Code.SIDE_STR[this.side];
  this.dir   = args.dir   || C.LEFT;
  this.mode  = args.mode  || 0;
  // set current position depending on casting mode
  if('current' in args)
    this.current = args.current;
  else {
    this.current = this.dir == C.LEFT ? this.right : this.left;
    if(this.hasFlag(C.SKIP_EMPTY)){
      let needle = this.findFirst(this.current, this.side, this.dir);
      if(!needle)
        throw "No stitch available for casting";
      else
        this.current = needle.index;
    }
  }
  // previous locations
  this.last  = { index: this.current, side: this.side };
  this.start = { index: this.current, side: this.side };
  // current buffer
  this.line  = this.emptyLine();
}

/**
 * Creates a yarn caster from a basic sheet specification
 *
 * @param dat the DATFile to use
 * @param line a bed side as an array with true/falsy values
 * @param options set of named options (side, dir, mode)
 */
Caster.fromSheet = function(dat, line, options){
  if(typeof line == 'number')
    line = Array.from({ length: line }).map(() => true);
  if(!options)
    options = {};
  options.mode |= C.SINGLE_SIDED;
  let side = options.side || 'front';
  return new Caster(dat, Array.from({ length: line.length }).map((x, index) => {
    let needle = { index };
    needle[side] = line[index];
    return needle;
  }), options);
};

/**
 * Create an empty yarn caster for a given bed width and initial direction
 *
 * @param dat the DATFile to use
 * @param width the bed width to allocate
 * @param args a set of named arguments (side, dir, mode)
 * @return the new empty yarn caster
 */
Caster.empty = function(dat, width, args) { // side, dir, mode){
  return new Caster(dat, Array.from({ length: width }).map((x, index) => {
    return { index };
  }), args);
};

/**
 * Manual bed transformation
 *
 * @param needle the bed needle { index, side }
 * @param state the new state of that needle
 */
Caster.prototype.setBedState =
Caster.prototype.setNeedleState = function(index, side, state){
  if(typeof side != 'string')
    side = Code.SIDE_STR[side];
  console.assert(index >= 0 && index < this.bed.length, 'Invalid needle index');
  this.bed[index][side] = state;
};

/**
 * Return the state of a needle
 *
 * - getBedState({ index, side })
 * - getBedState(index, side)
 *
 * @return the corresponding needle state
 */
Caster.prototype.getBedState =
Caster.prototype.getNeedleState = function(index, side){
  if(side === undefined && typeof index == "object"){
    side = index.side;
    index = index.index;
  }
  if(typeof side != 'string')
    side = Code.SIDE_STR[side];
  console.assert(index >= 0 && index < this.bed.length, 'Invalid needle index');
  return this.bed[index][side];
};

/**
 * Reset the casting mode
 *
 * @param mode the casting mode
 */
Caster.prototype.setMode = function(mode){
  console.assert(mode >= 0, 'Negative flags cannot be used for mode');
  this.mode = mode;
  return this;
};
Caster.prototype.setFlags = function(...flags){
  for(let i = 0; i < flags.length; ++i)
    this.setFlag(flags[i]);
  return this;
};
Caster.prototype.setFlag = function(flag){
  if(flag < 0)
    return this.removeFlag(-flag);
  else
    this.mode |= flag;
  return this;
};
Caster.prototype.removeFlag = function(flag){
  if(flag < 0)
    return this.setFlag(-flag);
  else
    this.mode &= ~flag;
  return this;
};
Caster.prototype.hasFlag = function(flag){
  if(flag < 0)
    return !this.hasFlag(-flag);
  else
    return this.mode & flag;
};

/**
 * Reset the operation range
 *
 * @param range an array [left, right]
 */
Caster.prototype.setRange = function(range){
  this.left = range[0] || 0;
  if(!range || range.length < 2) // note: range[1] may be 0 => cannot check falseness
    this.right = (this.bed.width || this.bed.length) - 1;
  else
    this.right = range[1];
  console.assert(this.current >= this.left && this.current <= this.right,
    'New range does not include current index');
  return this;
};

/**
 * Apply procedure with a temporary caster context
 *
 * @param context named context properties
 * @param fn the procedure to execute
 */
Caster.prototype.using = function(context, fn) {
  let prevCtx = {
    options:  Object.assign({}, this.options),
    carrier:  this.carrier,
    mode:     this.mode,
    // side:     this.side,
    // dir:      this.dir,
    left:     this.left,
    right:    this.right
  };
  let diffOptions = false;
  let diffCarrier = false;
  for(let name in context){
    let value = context[name];
    switch(name){
      case 'carrier': this.setCarrier(value); diffCarrier = this.carrier != value; break;
      case 'option':
      case 'options': this.addOptions(value); diffOptions = true; break;
      case 'flags':
                      if(Array.isArray(value)){
                        this.setFlags(...value);
                        break;
                      }
                      /* fall through */
      case 'flag':    this.setFlag(value); break;
      case 'left':    this.left = value; break;
      case 'right':   this.right = value; break;
      case 'block':   this.setRange([this.current, this.next(value - 1).index].sort()); break;
      default:
        throw "Unsupported context option " + name;
    }
  }
  // execute procedure
  fn();
  // if carrier or options changed
  // we need to flush the line (without changing the direction)
  if((diffCarrier || diffOptions) && this.hasData()){
    let currDir = this.dir;
    this.flush(); // might change direction
    this.switchDir(currDir);
  }
  // restore context
  for(let name in prevCtx)
    this[name] = prevCtx[name];
  return this;
};

/**
 * Returns an empty line
 *
 * @return an array of zeros whose size matches the bed width
 */
Caster.prototype.emptyLine = function(){
  return Array.from({ length: this.bed.width || this.bed.length }).map(() => 0);
};

/**
 * Return the first non-empty needle on a bed pass
 *
 * @param startIndex the first index to search from
 * @param side the bed side to search on
 * @param dir the search direction
 * @return the first found needle with a stitch or null
 */
Caster.prototype.findFirst = function(startIndex, side, dir){
  let last, incr;
  if(dir == C.LEFT){
    last = this.left;
    incr = -1;
  } else {
    last = this.right;
    incr = 1;
  }
  for(let idx = startIndex; idx != last; idx += incr){
    let needle = this.bed[idx][side];
    if(needle)
      return needle;
  }
  return null;
};

/**
 * Find the next non-empty needle on the path
 *
 * @param start the index to search from
 * @param side the side to search from
 * @param dir the direction to search towards
 * @return the found next non-empty needle
 */
Caster.prototype.findNext = function(current, side, dir){
  console.assert(current >= this.left && current <= this.right, 'Out of range');
  // let maxChecks = 2 * (Math.abs(this.right - this.left) + 1); // should never check more than that
  let initial = current;
  let incr, end;
  if(dir == C.LEFT){
    incr = -1;
    end = this.left;
  } else {
    incr = 1;
    end = 1;
  }
  for(let i = 0; current != end; ++i, current += incr){
    if(i > 0){
      // intial one is not valid
      if(this.bed[current][side])
        return { index: current, side };
    }
  }
  // switch to other side (or stop searching if mirroring)
  if(dir == C.LEFT){
    if(this.hasFlag(C.MIRROR_LEFT))
      return { index: initial, side }; // the initial one
    // switch
    dir = C.RIGHT;
    side = C.OTHER_SIDE[side];
    incr = 1;
    end = this.right;
  } else {
    if(this.hasFlag(C.MIRROR_RIGHT))
      return { index: initial, side };
    // switch
    dir = C.LEFT;
    side = C.OTHER_SIDE[side];
    incr = -1;
    end = this.left;
  }
  for(; current != end; current += incr){
    if(this.bed[current][side])
      return { index: current, side };
  }
  // nothing on other side => reversing => initial is the one
  return { index: initial, side };
};

/**
 * Returns the next stitch from the current commited position
 *
 * @param steps the number of steps to look for (1 by default)
 * @param inverse whether to look backward instead of forward
 * @return a stitch location { index, side }
 */
Caster.prototype.next = function(steps, inverse){
  // normalize arguments
  if(steps === undefined)
    steps = 1;
  else if(steps === 0)
    return { index: this.current, side: this.side };
  if(steps < 0)
    return this.next(-steps, !inverse);

  // temporary state
  let currIndex = this.current;
  let currSide = this.side;
  let dir = inverse ? C.INV_DIR[this.dir] : this.dir;

  // different modes
  if(false /*this.hasFlag(C.SKIP_EMPTY) */){
    // casting off or onto => allow only two passes
    let initDir = dir;
    while(steps--){
      let { index, side } = this.findNext(currIndex, currSide, dir);
      // if mirroring, we stop
      if(index == currIndex && side == currSide)
        return null;
      // change direction when switching side
      // and only allow it once
      if(side != currSide){
        if(dir != initDir)
          return null; // second turn not allowed
        dir = C.INV_DIR[dir];
        currSide = side;
      }
      currIndex = index;
    }
    return { index: currIndex, side: currSide };

  } else {
    const maxSteps = (Math.abs(this.right - this.left) + 1) * 2;
    const skipEmpty = this.hasFlag(C.SKIP_EMPTY);
    console.assert(steps <= maxSteps, 'Too many steps!');
    // casting on (!skipEmpty) or off (skipEmpty)
    let end, incr;
    let invFlag;
    if(dir == C.LEFT){
      end = this.left;
      incr = -1;
      invFlag = C.MIRROR_LEFT;
    } else {
      end = this.right;
      incr = 1;
      invFlag = C.MIRROR_RIGHT;
    }
    for(let i = 0; i < steps && i < maxSteps; ++i){
      if(currIndex == end){
        if(this.hasFlag(invFlag))
          return null;
        else
          currSide = C.OTHER_SIDE[currSide];
        // switch direction
        end = dir == C.LEFT ? this.right : this.left;
        dir = C.INV_DIR[dir];
        incr = -incr;
        invFlag = invFlag == C.MIRROR_LEFT ? C.MIRROR_RIGHT : C.MIRROR_LEFT;
      } else {
        currIndex += incr;
      }
      // skip empty bed needles
      if(skipEmpty && !this.bed[currIndex][currSide]){
        --i; // allow for one more step (since this one didn't count)
      }
    }
    return { index: currIndex, side: currSide };
  }
  // didn't find anything (not reachable)
  return null;
};
/**
 * See Caster::next()
 */
Caster.prototype.prev = function(steps){
  return this.next(steps, true);
};
/**
 * Count the number of stitches on the current commited bed
 */
Caster.prototype.count = function(){
  return this.bed.reduce((sum, n) => {
    if(n.front) sum += 1;
    if(n.back)  sum += 1;
    return sum;
  }, 0);
};
/**
 * Switch the current direction
 *
 * @param newDir a new direction to enforce
 */
Caster.prototype.switchDir = function(newDir){
  this.dir = newDir || C.INV_DIR[this.dir];
  return this;
};
/**
 * Switch the current side
 *
 * @param newSide a new side to enforce
 */
Caster.prototype.switchSide = function(newSide){
  if(newSide !== undefined){
    if(typeof newSide != 'string')
      newSide = Code.SIDE_STR[newSide];
    this.side = newSide;
  } else {
    this.side = C.OTHER_SIDE[this.side];
  }
  return this;
};
/**
 * Reset the current index
 *
 * @param index the new index
 */
Caster.prototype.resetIndex = function(index){
  this.current = index;
  return this;
};
/**
 * Return the current needle state
 *
 * @return { index, side, dir }
 */
Caster.prototype.getCurrentNeedle = function(){
  return { index: this.current, side: this.side, dir: this.dir };
};
/**
 * Reset the current needle state,
 * using a potential partial state
 *
 * @param needle { index, side, dir }
 */
Caster.prototype.setCurrentNeedle = function(needle){
  if('index' in needle)
    this.resetIndex(needle.index);
  if('side' in needle)
    this.switchSide(needle.side);
  if('dir' in needle)
    this.switchDir(needle.dir);
  return this;
};
/**
 * Apply a function locally without changing
 * the current needle index, side or direction
 *
 * @param fn the function to apply
 */
Caster.prototype.locally = function(fn){
  let needle = this.getCurrentNeedle();
  fn();
  this.setCurrentNeedle(needle);
  return this;
};

/**
 * Set the caster carrier
 *
 * @param carrier the yarn carrier identifier
 */
Caster.prototype.setCarrier = function(carrier){
  if(this.carrier != carrier){
    if(this.hasData())
      this.flush();
    this.carrier = carrier;
  }
  return this;
};
/**
 * Insert yarn for the current carrier
 *
 * @param manual whether to use a manual procedure
 * @param noHold whether not to use the holding hook
 */
Caster.prototype.insertYarn = function(...args){
  this.dat.insertYarn(this.dat.current, this.carrier, ...args);
  return this;
};
/**
 * Remove yarn
 *
 * @param manual whether to use a manual procedure
 * @param noHold whether not to use the holding hook
 */
Caster.prototype.removeYarn = function(...args){
  this.dat.removeYarn(this.dat.current, this.carrier, ...args);
  return this;
};
/**
 * Write options for the current line only
 *
 * @param options the options
 */
Caster.prototype.writeOptions = function(options){
  this.dat.setLineOptions(this.dat.current, options);
  return this;
};
/**
 * Set the yarn caster options
 */
Caster.prototype.setOptions = function(options){
  this.options = options;
  return this;
};
/**
 * Add options to the yarn caster
 */
Caster.prototype.addOptions = function(options){
  this.options = Object.assign(this.options, options);
  return this;
};
/**
 * Check whether the current buffer has some data in it
 *
 * @return true if it does, false otherwise
 */
Caster.prototype.hasData = function(){
  return this.line.some(x => x);
};

/**
 * Turn the direction of the casting process
 */
Caster.prototype.turn = function(){
  // add miss on current if empty
  if(!this.hasData()){
    this.line[this.current] = Code.MISS;
  }
  this.flush();
  return this;
};

/**
 * Turns the carrier around physically by using a single-miss line
 **/
Caster.prototype.flip = function(){
  // => needs to turn (and move the carrier)
  this.using({ flag: C.USER_MOVE }, () => {
    this.miss().flush();
  });
  return this;
};

/**
 * Decompose current line into a sub-segment (for using different options)
 */
Caster.prototype.splitLine = function(){
  if(this.hasData()){
    let dir = this.dir;
    this.flush();
    // while keeping the direction
    if(this.dir != dir)
      this.flip();
  }
  return this;
};

/**
 * Cast a specific action
 *
 * @param type the cast type
 * @param reverse whether to cast on the reverse bed
 */
Caster.prototype.cast = function(type, reverse){

  // string conversion
  if(typeof type == 'string'){
    console.assert(type in C.CAST_TYPE, 'Invalid cast type', type);
    type = C.CAST_TYPE[type];
  }

  // check if we should flush current line first
  if(this.line[this.current])
    this.flush();

  // add current stitch
  let side = !reverse ? this.side : C.OTHER_SIDE[this.side];
  this.line[this.current] = C.CAST_TYPE[type][side];

  // update bed (might add stitches)
  if(!this.hasFlag(C.IGNORE_BED)){
    // unless we should ignore bed changes
    // note: empty carrier remove things from needles
    let castSide = C.CAST_SIDE[type];
    if(castSide == 1 || castSide == 2)
      this.bed[this.current][side] = this.carrier != Code.EMPTY_CARRIER;
    if(castSide == -1 || castSide == 2)
      this.bed[this.current][C.OTHER_SIDE[side]] = this.carrier != Code.EMPTY_CARRIER;
  }

  // automatic move
  if(this.hasFlag(C.AUTO_MOVE))
    this.go();
  return this;
};

/**
 * Knit a regular stitch (for tubular)
 */
Caster.prototype.knit = function(reverse){
  return this.cast(Code.FRONT_KNIT, reverse);
};
C.CAST_TYPE.knit = Code.FRONT_KNIT;
/**
 * Knit a regular stitch (for patterning)
 */
Caster.prototype.pknit  =
Caster.prototype.stitch = function(reverse){
  return this.cast(Code.KNIT, reverse);
};
C.CAST_TYPE.pknit  =
C.CAST_TYPE.stitch = Code.KNIT;
/**
 * Knit a reversed stitch (for patterning)
 */
Caster.prototype.purl = function(reverse){
  return this.cast(Code.PURL, reverse);
};
C.CAST_TYPE.purl = Code.PURL;
/**
 * Double-sided stitch needle
 */
Caster.prototype.fbknit = function(){
  return this.cast(Code.FRONT_BACK_KNIT);
};
C.CAST_TYPE.fbknit = Code.FRONT_BACK_KNIT;
/**
 * Miss the current stitch needle
 */
Caster.prototype.miss = function(reverse){
  return this.cast(Code.MISS, reverse);
};
C.CAST_TYPE.miss = Code.MISS;
/**
 * Miss the current stitch needle (for patterning)
 */
Caster.prototype.pmiss = function(reverse){
  return this.cast(Code.FRONT_MISS, reverse);
};
C.CAST_TYPE.pmiss = Code.FRONT_MISS;
/**
 * Tuck the current stitch needle
 */
Caster.prototype.tuck = function(reverse){
  return this.cast(Code.FRONT_TUCK, reverse);
};
C.CAST_TYPE.tuck = Code.FRONT_TUCK;
/**
 * Tuck the current stitch needle (for patterning)
 */
Caster.prototype.ptuck = function(reverse){
  return this.cast(Code.TUCK, reverse);
};
C.CAST_TYPE.ptuck = Code.TUCK;
/**
 * Knit with kickback
 */
Caster.prototype.kbknit = function(reverse){
  return this.cast(Code.FRONT_KNIT_KICKBACK, reverse);
};
C.CAST_TYPE.kbknit = Code.FRONT_KNIT_KICKBACK;

/**
 * Split knit with move
 */
Caster.prototype.spknit =
Caster.prototype.split = function(move, reverse){
  let target = this.next(move);
  console.assert(target, 'No available split target');
  return this.splitInto(target.index, reverse);
};

Caster.prototype.splitInto = function(splitIndex, reverse){
  let delta = splitIndex - this.current;
  console.assert(Math.abs(delta) <= 2, 'Maximum split move is 2');
  let spMove = Math.max(-2, Math.min(2, delta));
  this.using({ flag: C.USER_MOVE }, () => {
    // miss to switch direction
    this.miss().flush();

    // split instruction
    let side = reverse ? Code.OTHER_SIDE[this.side] : this.side;
    this.instr(Code.SPLIT_FOR[side][spMove]);

    // flush with necessary options
    let transferToHook = spMove == 0 ? Code.TRANSFER_TO_HOOK : 0;
    this.flush({ [Code.SPLIT_TO_HOOK]: transferToHook });
    this.miss();

    // update bed (might add stitches)
    if(!this.hasFlag(C.IGNORE_BED)){
      // unless we should ignore bed changes
      this.bed[this.current][this.side] = true;
      let spSide = spMove == 0 ? C.OTHER_SIDE[side] : side;
      this.bed[this.current + spMove][spSide] = true;
    }
  });
  // automatic move
  if(this.hasFlag(C.AUTO_MOVE))
    this.go();
  return this;
};

/**
 * Add holding tuck
 */
Caster.prototype.hold = function(){
  console.assert(this.side == this.last.side, 'Must hold before switching side');
  return this.holdAt(this.last.index, this.side);
};

/**
 * Add a holding tuck at a specific position
 *
 * @param index the needle index
 * @param side the bed side (defaults to current)
 */
Caster.prototype.holdAt = function(index, side){
  if(side === undefined)
    side = this.side;
  if(typeof side != 'string')
    side = Code.SIDE_STR[side];
  console.assert(this.carrier != Code.EMPTY_CARRIER, 'Cannot hold with empty carrier');
  console.assert(!this.bed[index][side], 'Holding on stitch');
  console.assert(!this.line[index], 'Pending instruction at the holding position, you need to flush');
  // add tuck
  this.line[index] = C.CAST_TYPE[Code.FRONT_TUCK][side];

  // update bed
  if(!this.hasFlag(C.IGNORE_BED)){
    this.bed[index][side] = true;
  }
  return this;
};

/**
 * Apply an unspecified instruction
 *
 * @param num the instruction number
 */
Caster.prototype.instr = function(num){
  console.assert(!this.line[this.current], 'Replacing instruction on current line');
  this.line[this.current] = num;
  if(this.hasFlag(C.AUTO_MOVE))
    this.go();
  // TODO implement instruction simulation to update the bed
  // currently, the bed is not updated with custom instructions
  return this;
};

Caster.prototype.instrBlock = function(instrs, needles, transfer){
  // normalize needles into array of needles
  if(needles === undefined){
    needles = Array.from({ length: this.right - this.left + 1 }).map((_, idx) => {
      return { index: this.left + idx, side: this.side };
    });
  } else if(typeof needles == 'number'){
    console.assert(Array.isArray(instrs),
      'Instruction block must be an array if passing a first needle index');
    needles = Array.from({ length: instrs.length }).map((_, idx) => {
      return { index: needles + idx, side: this.side };
    });
  }
  console.assert(Array.isArray(needles), 'Invalid needles arguments');
  // normalize instructions into array of instructions
  if(typeof instrs == 'function')
    instrs = needles.map(instrs);

  // ensure there's no data on this line
  if(this.hasData())
    this.flush();

  // fill line
  for(let i = 0; i < instrs.length; ++i){
    let { index } = needles[i];
    console.assert(!this.line[index], 'Conflicting needles in same block');
    this.line[index] = instrs[i];
  }

  // update position and state
  let indices = needles.map(({ index }) => index);
  let dirSign = Code.DIR_SIGN[this.dir];
  let farther = indices.reduce((far, idx) => {
    return (far - this.current) * dirSign >= (idx - this.current) * dirSign ? far : idx;
  }, this.current);
  if(transfer){
    // move to farthest needles in current direction
    this.current = farther;
    this.flush(C.TRANSFER);
  } else {
    this.current = farther;
    if(this.hasFlag(C.AUTO_MOVE))
      this.go();
  }
  return this;
};

/**
 * Move caster to a specific needle
 *
 * @param index the needle index
 * @param side the bed side (or the current one)
 * @param dir the expected direction (or no constraint)
 */
Caster.prototype.moveTo = function(index, side, dir, useMisses){
  let prev = this.current;
  let delta = index - prev;
  let turned = false;
  if(delta){
    let sign = delta > 0 ? 1 : -1;
    // note: /!\ if invalid direction, but within 1 stitch, no need to turn
    if(sign != Code.DIR_SIGN[this.dir] && delta * sign > 1){
      // we must change direction
      turned = true;
      this.turn();
      console.assert(sign == Code.DIR_SIGN[this.dir], 'Turn did not work');
    }
    if(useMisses){
      let i = this.line[prev] ? prev + sign : prev;
      for(; i != index; i += sign){
        console.assert(!this.line[i], 'Cannot miss continuously');
        this.line[i] = Code.MISS;
      }
    }
    this.current = index;
  }
  // explicit new side
  if(side !== undefined){
    if(typeof side != 'string')
      side = Code.SIDE_STR[side];
    if(side != this.side && this.hasData() && !turned)
      this.flush();
    // set side
    this.side = side;
  }
  // explicit new direction
  if(dir !== undefined && dir != this.dir){
    // we must change direction
    this.turn();
    console.assert(this.dir == dir, 'Turn did not work');
  }
  return this;
};
Caster.prototype.missTo = function(index, side, dir){
  return this.moveTo(index, side, dir, true);
};

/**
 * Update position to the next stitch.
 * The behaviour depends on the casting mode.
 * - casting on => follow the direction
 * - casting off => go to the next available stitch
 */
Caster.prototype.go =
Caster.prototype.then = function(){
  // look for next position
  let n = this.next();

  // if no next needle
  //  => changing direction, same location
  // if changing side
  //  => also changing direction
  if(!n || n.side != this.side){
    let dirChanged = this.flush();
    // if flushing didn't happen
    // then manually change direction since we reached the bed end
    if(!dirChanged){
      this.dir = C.INV_DIR[this.dir];
    }
  }

  // remember location
  this.last = { index: this.current, side: this.side };

  // and update current location
  // /!\ special case for ending side
  if(n){
    this.current = n.index;
    this.side = n.side;
  } else if(this.hasFlag(C.SKIP_EMPTY)
    && !this.bed[this.current][this.side]){
    // find next available non-empty needle and move there
    n = this.next();
    if(n){
      this.current = n.index;
      this.side = n.side;
    }
  }
  return this;
};

/**
 * Transfer the current stitch sideways and then turn
 *
 * @param arg either the number of signed steps, or a needle { index, side }
 */
Caster.prototype.move = function(arg){
  // TODO if casting on, we need to check that there's a needle where we are
  // find needle of target
  let src = { index: this.current, side: this.side };
  let trg;
  if(typeof arg == 'number'){
    trg = arg < 0 ? this.prev(-arg) : this.next(arg || 1);
    console.assert(trg, 'Move impossible as there are no other needle available');
  } else {
    let { index, side } = arg;
    if(typeof side != 'string')
      side = Code.SIDE_STR[side];
    trg = { index, side };
  }

  // did we normally knit over the current location?
  let stitch = this.line[this.current];
  let knitting = stitch == C.CAST_TYPE[Code.KNIT][this.side];
  // note: knitting=1/2, not 51/52 which are different (assume knit-cancel)

  // do we have to commit before?
  if(!knitting && this.hasData()){
    this.flush();
  }
  this.line[this.current] = Code.getTransferCode(src.index, src.side, trg.index, trg.side);

  // ready to write line
  let options = {};
  if(!this.hasFlag(C.IGNORE_BED)){
    if(src.side == trg.side && this.bed[src.index][Code.OTHER_SIDE[src.side]]){
      // we must use sliders
      options[Code.TRANSFER_TYPE] = Code.getTransferType(src.side, true); // compulsive=true?
    }
  }
  if(knitting){
    this.flush(options);
  } else {
    let currDir = this.dir;
    this.flush(options, C.TRANSFER); // transfer mode
    this.switchDir(currDir); // to stay in current direction
  }

  // update bed
  if(!this.hasFlag(C.IGNORE_BED)){
    this.bed[src.index][src.side] = false;
    this.bed[trg.index][trg.side] = true;
  }

  // automatic move
  if(this.hasFlag(C.AUTO_MOVE))
    this.go();

  return this;
};

/**
 * Transfer the current stitch to the other side of the bed
 */
Caster.prototype.transfer = function(){
  // did we normally knit over the current location?
  let stitch = this.line[this.current];
  let knitting = stitch == C.CAST_TYPE[Code.KNIT][this.side];

  // do we have to commit before?
  if(!knitting && this.hasData()){
    this.flush();
  }
  let thisSide = this.side;
  let otherSide = C.OTHER_SIDE[thisSide];
  this.line[this.current] = Code.getTransferCode(this.current, thisSide, this.current, otherSide);

  // ready to write line
  if(knitting)
    this.flush();
  else {
    let currDir = this.dir;
    this.flush(C.TRANSFER); // transfer mode (knit cancel)
    this.switchDir(currDir); // to stay in current direction
  }

  // update bed
  if(!this.hasFlag(C.IGNORE_BED)){
    this.bed[this.current][otherSide] |= !!this.bed[this.current][thisSide];
    this.bed[this.current][thisSide] = false;
  }
  // automatic move
  if(this.hasFlag(C.AUTO_MOVE))
    this.go();

  return this;
};

/**
 * Transfer a sequence of stitches to the other bed.
 *
 * Multiple way to call:
 * - uniform:     groupTransfer(N, flags)
 * - functional:  groupTransfer(N, flags, i => f(i))
 * - array:       groupTransfer(array, flags)
 *
 * @param groupSize the size of the group
 * @param mode the transfer flags (side, knit before, knit after)
 * @param map the transfer shift per index
 */
Caster.prototype.groupTransfer = function(groupSize, mode, map){
  if(!mode)
    mode = 0;
  if(map)
    console.assert(Array.isArray(map) || typeof map == 'function');
  if(Array.isArray(groupSize)){
    console.assert(!map, 'Cannot use array and functional forms together');
    map = groupSize;
    groupSize = map.length;
  }
  // knitting flags
  let knitting = mode & (C.KNIT_BEFORE | C.KNIT_AFTER);

  // group transfer done on separate line (because of R9=1)
  if(!knitting){
    this.splitLine();
  }

  // gather group information
  let indices = [];
  for(let i = 0; i < groupSize; ++i){
    let trg = this.next(i);
    if(trg)
      indices.push(trg.index);
    else
      console.log('Warning: invalid group transfer for range: left/right/curr/i', this.left, this.right, this.current, i);
  }

  // generate transfer group
  let thisSide = mode & C.FRONT_TO_BACK ? 'front' : mode & C.BACK_TO_FRONT ? 'back' : this.side;
  let otherSide = mode & C.SAME_BED ? thisSide : C.OTHER_SIDE[thisSide];
  if(!map){
    console.assert(otherSide != thisSide, 'Move requires custom transfer');
    // uniform transfer
    let instr = Code.getTransferCode(this.current, thisSide, this.current, otherSide, mode & C.KNIT_AFTER);
    for(let idx of indices){
      console.assert(!this.line[idx], 'Replacing instruction in group transfer');
      this.line[idx] = instr;
      // update bed
      if(!this.hasFlag(C.IGNORE_BED)){
        this.bed[idx][otherSide] |= !!this.bed[idx][thisSide];
        this.bed[idx][thisSide] = false;
      }
    }
  } else {
    // customized transfer
    console.assert(!this.hasFlag(C.SKIP_EMPTY), 'Mapped group transfer not supported with SKIP_ENTRY flag');
    for(let i = 0; i < indices.length; ++i){
      let idx = indices[i];
      this.current = idx;
      let shift = Array.isArray(map) ? map[i] : map(i);
      let instr;
      if(shift === 0 && (mode & C.SAME_BED))
        shift = false; // same-bed transfer either misses or
      if(shift === false || shift === undefined || shift === null)
        instr = knitting ? Code.MISS : 0;
      else if(shift === 0 && (mode & C.SAME_BED)){
        instr = C.CAST_TYPE[Code.STITCH][thisSide];
      } else {
        let otherIndex = this.next(shift);
        console.assert(otherIndex, 'Invalid mapping', shift, 'out of reach');
        otherIndex = otherIndex.index;
        instr = Code.getTransferCode(this.current, thisSide, otherIndex, otherSide, mode & C.KNIT_AFTER);
        // update bed
        if(!this.hasFlag(C.IGNORE_BED)){
          this.bed[otherIndex][otherSide] |= !!this.bed[this.current][thisSide];
          this.bed[this.current][thisSide] = false;
        }
      }
      console.assert(!this.line[idx], 'Replacing instruction in group transfer');
      this.line[idx] = instr;
    }
  }

  // sliders
  if(mode & C.USING_SLIDERS){
    // add temporary option for this line
    // XXX use Code.getTransferType
    this.dat.setLineOption(this.dat.current, Code.TRANSFER_TYPE, thisSide == 'front' ? 51 : 52);
  }

  // update position and state
  if(knitting){
    this.current = indices[indices.length-1];
    if(this.hasFlag(C.AUTO_MOVE))
        this.go(); // move to index past last
    // else we stay at the last index
  } else {
    this.current = indices[0]; // rewind to the first index
    this.flush(C.TRANSFER); // transfer mode (knit cancel)
  }

  return this;
};

Caster.prototype.clear = function(needles, numPasses){
  if(this.hasData())
    this.flush();
  if(numPasses <= 0)
    numPasses = 1;
  needles = Array.from(needles);
  this.using({ carrier: Code.EMPTY_CARRIER }, () => {
    while(numPasses--){
      for(let { index, side } of needles){
        this.moveTo(index, side);
        this.knit();
      }
      needles.reverse();
    }
    this.flush();
  });
  return this;
};

Caster.prototype.flush = function(options, dir){
  if(!dir && typeof options == 'number'){
    dir = options;
    options = null;
  }
  if(options)
    options = Object.assign({}, this.options, options);
  else
    options = Object.assign({}, this.options);
  if(!dir)
    dir = this.dir;

  // find bounds
  let first = this.line.findIndex(v => v);
  let last  = -1;
  for(let i = this.line.length - 1; i >= 0 && last == -1; --i){
    if(this.line[i])
      last = i;
  }
  if(first == -1 || last == -1){
    return false;
  }
  this.line = this.line.map((v, idx) => idx >= first && idx <= last ? v || Code.LINK_PROCESS : v);

  // fill range with link processing
  if(this.hasFlag(C.LINK_PROCESS)){
    // XXX are there exceptions?
    this.line = this.line.map((v, idx) => this.bed[idx].front || this.bed[idx].back ? v || Code.LINK_PROCESS : v);
  }

  // apply cross joint codes if necessary
  let crossStartIdx = this.line.findIndex(instr => Code.IS_CROSS[instr]);
  if(crossStartIdx != -1){
    // make link-process / empty within cross pairs joint codes
    // joint codes should appear between same-cable sides of a pair
    // (e.g. left-left or right-right , but not between left-right)
    let cross = this.line[crossStartIdx];
    let crossSides = 1;
    let jointIndices = [];
    for(let i = crossStartIdx + 1; i < this.line.length; ++i){
      let value = this.line[i];
      if(cross){
        // check for ending cross pair side
        // or empty to use joint code
        //
        if(value != cross){
          // cross pair
          if(Code.CROSS_COMPLEMENTS_OF[cross].includes(value)){
            ++crossSides;
            cross = value; // switching side
          } else if(!value || value == Code.LINK_PROCESS){
            // potential joint code (for half-gauge pairs)
            // /!\ note: can also be beyond a cross side (relief / no-cable)
            jointIndices.push(i);
          } else if(Code.IS_CROSS[value]){
            // end of current cross pair side
            cross = null;
          }
        } else {
          // apply joint processing if any
          for(let idx of jointIndices)
            this.line[idx] = Code.CROSS_JOINT_CODE;
          jointIndices = []; // clear list
        }
      } else if(Code.IS_CROSS[value]){
        // start new cross pair
        cross = value;
        ++crossSides;
      }
    }
    console.assert(crossSides % 2 === 0, 'Unpaired cross instruction');
  }

  // special direction treatment
  if(dir != C.TRANSFER){
    let compDir = this.dat.computeDirectionFor(this.dat.current);
    if(compDir != dir){
      if(Code.CARRIER_MOVE in options)
        console.assert(Code.CARRIER_MOVE == Code.CARRIAGE_MOVE, 'Carrier move option in conflict');
      options[Code.CARRIER_MOVE] = Code.CARRIAGE_MOVE; // force direction switch
    }
  } else {
    // transfer direction => carrier mode must be transfer mode
    let currMode = options[Code.CARRIER_MODE];
    console.assert(!currMode || currMode == Code.TRANSFER_MODE, 'Conflicting carrier mode');
    options[Code.CARRIER_MODE] = Code.TRANSFER_MODE;
  }

  // set carrier (overwrite!)
  console.assert(!options[Code.CARRIER] || options[Code.CARRIER] == this.carrier,
    'Do not use carrier option directly, instead specify the carrier with Caster::setCarrier');
  options[Code.CARRIER] = this.carrier;

  // effective writing in DAT file
  this.dat.setSegment(this.dat.current, 0, this.line, options, dir, true);
  if(dir != C.TRANSFER)
    this.dir = C.INV_DIR[dir]; // switch direction
  this.line = this.emptyLine(); // reset buffer

  return true;
};


module.exports = Object.assign(Caster, C);
