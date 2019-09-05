// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('./assert.js');
const Course = require('./course.js');
const { inferSidedness } = require('./infer.js');
const Pattern = require('./pattern.js');
const Shaper = require('./shaper.js');
const Timer = require('./timer.js');
const sk = require('./skeleton.js');
const env = require('./env.js');

function Shape(node) {
  this.node = node;
  // this.stitches = [];
  this.courses    = [];
  this.courseMap  = {};
  this.bedsMap    = {};
  this.courseItfs = {};
  this.offsets    = {};
  this.initial    = null; // initial side
  this.shortrows  = {};
  this.itfs       = [];
  this.sided      = false;
  this.sidedness  = {}; // memorization
}

/**
 * Get the scaling factor of needles on their effective bed
 *
 * @return 1 (full gauge) or 2 (half gauge) or something else ...
 */
Shape.prototype.getNeedleScale = function(){
  switch(this.node.gauge || 'full'){
    case 'full':
    case 1:
    case '1':
      return 1;
    case 'half':
    case 2:
    case 0.5:
    case '2':
    case '1/2':
      return 2;
    default:
      throw "Unsupported gauge " + this.node.gauge;
  }
};

/**
 * Check whether a course of this shape should be laid out over two beds.
 * To call this method before the course has been created, use noCRS=true.
 *
 * @param crsIdx the course identifier
 * @param noCRS whether to skip checking the course information
 * @return whether the corresponding course is considered two-sided
 */
Shape.prototype.isTwoSided = function(crsIdx, noCRS){
  // checking course information
  if(!noCRS){
    let crs = this.getCourse(crsIdx);
    assert(crs, 'Course does not exist: ' + this.node.id + '/' + crsIdx);
    // unbounded courses are always twosided
    if(crs.side == Course.BOTH)
      return true;
  }

  // else delegate to inference algorithm
  if(!(crsIdx in this.sidedness)){
    // if course has interface name, use that instead (e.g. 0 => bottom)
    let crsName = crsIdx in this.courseItfs ? this.courseItfs[crsIdx] : crsIdx;
    // infer sidedness
    this.sidedness[crsIdx] = inferSidedness(this.node, crsName);
  }
  return this.sidedness[crsIdx];
};
/**
 * Add a new course to the shape
 *
 * @param course the course to add
 * @param prepend whether to prepend (true) or append (false) the course to the shape
 * @return the set of stitches forming the new course
 */
Shape.prototype.addCourse = function(course, prepend){
  if(prepend)
    this.courses.unshift(course);
  else
    this.courses.push(course);
  return course;
};
/**
 * Set a named course
 *
 * @param name the name of the course
 * @param course the stitches belonging to that course (or null to delete it)
 */
Shape.prototype.setCourse = function(name, course){
  if(course)
    this.courseMap[name] = course;
  else
    delete this.courseMap[name];
};
/**
 * Set a pair of named suspended beds
 *
 * @param name the name of the beds
 * @param beds [front, back]
 */
Shape.prototype.setBeds = function(name, beds){
  this.bedsMap[name] = beds;
};
/**
 * Return a set of named suspended beds
 *
 * @param name
 * @return [front, back]
 */
Shape.prototype.getBeds = function(name){
  return this.bedsMap[name];
};
/**
 * Set the interface name corresponding to a course name
 *
 * @param name the course name (can be a number)
 * @param itfName the interface name
 */
Shape.prototype.setCourseInterface = function(name, itfName){
  this.courseItfs[name] = itfName;
};
/**
 * Retreive a course by its name
 *
 * @param name course name
 * @return the corresponding interface course
 */
Shape.prototype.getCourse = function(name){
  if(typeof name == 'string')
    return this.courseMap[name];
  else
    return this.courses[name];
};
/**
 * Retrieve the name associated with a course identifier
 *
 * @param crsId the course identifier
 * @return its string name (or null if none)
 */
Shape.prototype.getCourseName = function(crsId){
  if(typeof crsId == 'string')
    return crsId;
  assert(typeof crsId == 'number', 'Unsupported course identifier');
  const crs = this.courses[crsId];
  for(let name in this.courseMap){
    if(this.courseMap[name] == crs)
      return name;
  }
  // none found
  return null;
};
/**
 * Checks whether a course is a short row
 *
 * @param crsId the course identifier (string or number)
 * @return whether the corresponding course is a short row
 */
Shape.prototype.isShortRow = function(crsId){
  return this.shortrows[crsId];
};
/**
 * Find the course of a stitch within this shape
 * checking first in main courses (with number indices)
 * and then within named courses (with string indices)
 *
 * @param stitch the stitch to locate
 * @return the index of the course it belongs to or -1 if it is not within this shape
 */
Shape.prototype.courseIndexOf = function(stitch){
  if(typeof stitch == 'number'){
    // node identifier testing
    for(let i = 0; i < this.courses.length; ++i)
      if(this.courses[i].find(n => n && n.id == stitch))
        return i;
    for(let name in this.courseMap)
      if(this.courseMap[name].find(n => n && n.id == stitch))
        return name;
  } else {
    // direct equality testing for objects
    for(let i = 0; i < this.courses.length; ++i)
      if(this.courses[i].find(n => n && n == stitch))
        return i;
    for(let name in this.courseMap)
      if(this.courseMap[name].find(n => n && n == stitch))
        return name;
  }
  return -1;
};

/**
 * Bind the sides of two shapes
 * by merging them according to their rotation.
 * Assumes the courses are not course-connected yet
 * so that their orientation doesn't really matter.
 *
 * This means that both crs[0] and crs[crs.length-1] are endpoint stitches
 * with at most one course connection (within crs), where crs
 * represents both the first and second course.
 *
 * @param shape1 the first shape
 * @param name1 the first side
 * @param shape2 the second shape
 * @param name2 the second side
 */
Shape.bind = function(shape1, name1, shape2, name2){
  // note: splits are special since they do not have correct intra-course information
  //       => they should have lower priority in merging order
  if(shape1.node.category == sk.NODE_SPLIT && shape2.node.category != sk.NODE_SPLIT){
    // do it the other way around so we don't lose important course connections
    Shape.bind(shape2, name2, shape1, name1);
    return;
  }
  
  if(env.verbose)
    console.log('Binding ' + shape1.node + '/' + name1 + ' with ' + shape2.node + '/' + name2);
  const course1 = shape1.getCourse(name1);
  const course2 = shape2.getCourse(name2);

  // get interface
  let itf = shape1.node.getInterfaces().filter(i => i.thisSide(shape1.node).path == name1);
  if(itf.length !== 1){
    console.log('Could not find interface ' + name1 + ' of ' + shape1.node);
    return;
  } else
    itf = itf[0];

  // check it's all right
  const IDs = [ shape1.node.id + '/' + name1, shape2.node.id + '/' + name2 ];
  const itfID = (n) => itf.sides[n].node.id + '/' + itf.sides[n].path;
  assert(itf.isConnected(), 'Binding disconnected interface');
  assert(IDs.indexOf(itfID(0)) != -1 && IDs.indexOf(itfID(1)) != -1, 'Interface mismatch');

  // take care of gauge transitions
  if(shape1.node.gauge != shape2.node.gauge){
    const g1 = shape1.getNeedleScale();
    const g2 = shape2.getNeedleScale();
    const n1 = course1.length * g1;
    const n2 = course2.length * g2;

    // attempt to close one course to match length
    if(n1 == n2 * 2 && course1.circular)
      course1.close();
    else if(n2 == n1 * 2 && course2.circular)
      course2.close();

    // create binding spreading wales as uniformly as possible
    course1.spread(course2, g1 / g2);

  } else {
    // try reducing courses to same length
    if(course1.length != course2.length){
      // attempt to close one course to match length
      if(course1.length == course2.length * 2 && course1.circular){
        course1.close();
      } else if(course2.length == course1.length * 2 && course2.circular){
        course2.close();
      } else {
        // create binding without spreading wales at all
        // = default split into head and disconnected tail
        course1.spread(course2, 1);
        return;
      }
    }

    // bind or merge
    if(course1.length === course2.length){
      // bind courses by merging
      course1.merge(course2);
    } else {
      // bind courses with identity spread
      course1.spread(course2, 1);
    }
  }
};

/**
 * Build a shape from a node and starting interface
 *
 * @param node the node to create a shape for
 * @param start the interface to start from
 * @return the newly created shape
 */
Shape.build = function(node, start){
  let shape = null;
  switch(node.category){
    case sk.NODE_SHEET: shape = buildSheet(node, start); break;
    case sk.NODE_JOINT: shape = buildJoint(node, start); break;
    case sk.NODE_SPLIT: shape = buildSplit(node, start); break;
    case sk.NODE_CUSTOM: shape = buildCustom(node, start); break;
    default: return null;
  }
  // set initial side
  shape.initial = start;

  return shape;
};

/**
 * Create a sheet without its course connections
 *
 * @param node a sheet node
 * @return a sheet shape
 */
function buildSheet(node){
  let shape = new Shape(node);
  const length = node.length;
  const flat = node.type == sk.FLAT;
  const gauge = shape.getNeedleScale();
  if(length <= 1){
    const w = Math.round(node.width.first()) || 1;
    shape.addCourse(Course.create(w, flat, gauge));
  } else {
    const dt = 1 / (length-1);
    for(let c = 0, t = 0; c < length; ++c, t += dt){
      const w = Math.round(node.width.eval(t)) || 1;
      shape.addCourse(Course.create(w, flat, gauge));
    }
  }
  assert(length === shape.courses.length, 'Missing a course');

  // use shaper to create parent-child links
  const tubular = !flat;
  Shaper.apply(node.shaper, shape.courses, tubular);

  // extend courses depending on alignment
  if(node.alignment != sk.ALIGN_LEFT){
    const maxWidth = shape.courses.reduce((max, crs) => Math.max(max, crs.width), 0);
    for(let i = 0; i < length; ++i){
      const crs = shape.courses[i];
      let offset;
      if(node.alignment == sk.ALIGN_CENTER){
        offset = Math.round((maxWidth - crs.width)/2);
      } else if(node.alignment == sk.ALIGN_RIGHT){
        offset = maxWidth - crs.width;
      }
      crs.offset = offset;
    }
  } // else no need to offset

  // grid shaping
  if(node.shaper == Shaper.NONE){
    for(let i = 1; i < length; ++i){
      const prevCrs = shape.getCourse(i-1);
      const currCrs = shape.getCourse(i);
      gridWales(prevCrs, currCrs);
      /*
      const needles = prevCrs.toBeds();
      // create matching wales
      for(let currStitch of currCrs){
        const { index, side } = currCrs.needleOf(currStitch);
        let prevStitch = needles[side][index];
        if(prevStitch){
          prevStitch.wale(currStitch);
        }
      } // endfor currStitch of currCrs
      */
    } // endfor i < #length
  } // endif Shaper.NONE

  // register interface courses
  shape.setCourse('bottom', shape.courses[0]);
  shape.setCourse('top', shape.courses[shape.courses.length-1]);

  // register numbered interface names
  shape.setCourseInterface(0, 'bottom');
  shape.setCourseInterface(shape.courses.length-1, 'top');

  return shape;
}

/**
 * Create a set of short rows
 *
 * @param rows the number of short rows
 * @param width the width function
 * @return the list of courses
 */
function shortRows(rows, width){
  // note: short rows are bounded by definition
  assert(rows > 0, 'No short rows!');
  // special case for single row
  if(rows === 1)
    return [ Course.stitches(width.first()) ];

  // else we have multple short rows to create
  const list = [];
  const dt = 1 / (rows-1);
  for(let c = 0, t = 0; c < rows; ++c, t += dt){
    const w = Math.round(width.eval(t)) || 1;
    list.push(Course.stitches(w));
  }
  return list;
}

/**
 * Create a joint without its course connections
 *
 * @param node a joint node
 * @return a joint shape
 */
function buildJoint(node){
  let shape = new Shape(node);
  // extract values
  const { rows, width, alignment } = node;
  const position = node.layout.getPosition(0);

  // get size information
  // /!\ we want same size at each interface
  const circular = inferSidedness(node, 'bottom') || inferSidedness(node, 'top');
  const botSize = node.bottom.getSize();
  const topSize = node.top.getSize();
  assert(botSize == topSize, 'Joint must be between two interfaces of same size');

  // create grid of cells for merging short rows and creating wales
  const gridHeight = 4 + rows; // 4 for bot+top+botcont+topcont
  const gridWidth = botSize * (circular ? 2 : 1);
  let grid = Array.from({ length: gridHeight }).map(() => Array.from({ length: gridWidth }));

  // insert interface stitches
  grid[0] = Course.stitches(gridWidth);
  grid[gridHeight-1] = Course.stitches(gridWidth);

  // create short rows
  let shorts = shortRows(rows, width);
  let offset = Math.round(position * (gridWidth - 1));

  // insert them following the alignment
  // assuming location warp around a cylinder (even if FLAT)
  for(let r = 0; r < shorts.length; ++r){
    let gridRow = grid[r+2];
    let shortRow = shorts[r];
    for(let c = 0; c < shortRow.length; ++c){
      let gridCol;
      let shortCol;
      switch(alignment){
        case sk.ALIGN_LEFT:
          gridCol  = (offset + c) % gridWidth;
          shortCol = c;
          break;
        case sk.ALIGN_RIGHT:
          gridCol  = (gridWidth + offset - c) % gridWidth;
          shortCol = shortRow.length - 1 - c;
          break;
        case sk.ALIGN_CENTER:
          gridCol  = (gridWidth + offset - Math.floor(shortRow.length/2) + c) % gridWidth;
          shortCol = c;
          break;
        default:
          throw "Invalid alignment " + node.alignment;
      }
      // should be empty
      assert(!gridRow[gridCol], 'Overlapping short row stitches');
      gridRow[gridCol] = shortRow[shortCol];
    }
  }

  // the following gets generated during yarn tracing:
  // - vertical wales
  // - side wales
  // - course connections
  // - continuity stitches

  // transform grid into list of courses
  // + apply gauge
  const gauge = shape.getNeedleScale();
  shape.courses = grid.map((row, idx) => {
    const isITF = idx == 0 || idx == grid.length - 1;
    return Course.fromLayout(row, circular, isITF, true).gauged(gauge);
  });

  // specify short rows
  for(let i = 2; i < grid.length - 2; ++i)
    shape.shortrows[i] = true;

  // register interface courses
  shape.setCourse('bottom', shape.courses[0]);
  shape.setCourse('top', shape.courses[shape.courses.length-1]);
  // register numbered interface names
  shape.setCourseInterface(0, 'bottom');
  shape.setCourseInterface(shape.courses.length-1, 'top');
  // register continuity courses
  shape.setCourse('bottomcont', shape.courses[1]);
  shape.setCourse('topcont', shape.courses[shape.courses.length-2]);

  return shape;
}

/**
 * Create a split shape consisting of a set of interface courses
 * and an additional continuity course for the transition
 * between the base interface and the continuously branch.
 * The core shape has no course, it only has named courses.
 * 
 * @param node a split node
 * @return a split shape
 */
function buildSplit(node){
  const shape = new Shape(node);

  // create base course (that will be used for the branch courses)
  const width = node.base.getSize();
  const twosided = shape.isTwoSided('base', true);
  const gauge = shape.getNeedleScale();

  // no course is added to the shape directly
  const baseCourse = Course.create(width, !twosided, gauge);
  shape.setCourse('base', baseCourse);

  // create continuity course
  const contCourse = Course.empty(twosided);
  shape.setCourse('continuity', contCourse);

  // layout range
  const unfolded = !shape.node.folded && twosided;
  const posRange = baseCourse.width * (unfolded ? 2 : 1);

  // allocate branch courses
  for(let i = 0; i < node.branches.length; ++i){
    let branch = node.branches[i];
    let braName = 'branches/' + i;
    let braWidth = branch.getSize();
    let braTwoSided = shape.isTwoSided(braName, true);
    let braCrs = Course.create(braWidth, !braTwoSided, gauge);
    // layout offset, side and direction
    let offset = Math.round(shape.node.layout.getPosition(i) * posRange); // positions[i];
    if(unfolded){
      // unfolded around twosided base (braCrs is one-sided)
      if(offset * 2 >= posRange){
        // rotated to the back side
        braCrs.mirror();    // inverted needle indices
        braCrs.flipBeds();  // inverted bed sides
        braCrs.offset = baseCourse.width * 2 * gauge - (offset + braWidth * gauge);
        if(gauge > 1)
          braCrs.offset += 1; // partial-gauge on back
        // XXX is that offset correct? (no +/- 1 error?)
      } else {
        //on the front side => normal offset
        braCrs.offset = offset;
      }
    } else {
      // normal offset (either one-sided, or two-sided)
      braCrs.offset = offset;
    }
    // register name
    shape.setCourse(braName, braCrs);
  }

  return shape;
}

/**
 * Build a custom node by evaluating its associated code
 *
 * @param node a custom node
 * @return the corresponding shape
 */
function buildCustom(node){
  const shape = new Shape(node);
  const { courses, beds } = node.eval(env.verbose);
  shape.courses = courses;
  for(let i = 0; i < beds.length; ++i){
    if(beds[i]){
      shape.setBeds(i, beds[i]);
    }
  }
  // XXX other things to transfer?

  // register interface courses
  shape.setCourse('bottom', shape.courses[0]);
  shape.setCourse('top', shape.courses[shape.courses.length-1]);
  // register numbered interface names
  shape.setCourseInterface(0, 'bottom');
  shape.setCourseInterface(shape.courses.length-1, 'top');
  return shape;
}

/**
 * Trace yarn over a shape
 *
 * @param seq course traversal order
 * @param yarn { starting, ending } information about the state of the yarn
 */
Shape.prototype.trace = function(seq, yarn){
  //
  // Trace yarn to
  // 
  // 1. Create course connections
  // 2. Generate additional continuity stitches
  //
  switch(this.node.category){
    case sk.NODE_SHEET:
      traceSheet(this, seq, yarn);
      this.sided = this.node.type == sk.CYLINDER;
      break;
    case sk.NODE_JOINT:
      traceJoint(this, seq, yarn);
      this.sided = false;
      break;
    case sk.NODE_SPLIT:
      traceSplit(this, seq, yarn);
      this.sided = this.isTwoSided('base');
      break;
    case sk.NODE_CUSTOM:
      traceCustom(this, seq, yarn);
      break;
    default:
      throw "Unsupported yarn tracing of category " + this.node.category;
  }

  // record interface order
  if(this.node.category == sk.NODE_SPLIT){
    if(seq[seq.length-1] == 'base'){
      this.itfs = [this.node.branches, this.node.base];
    } else {
      this.itfs = [this.node.base, this.node.branches];
    }
  } else {
    this.itfs = seq[seq.length - 1] > 0 ?
      [this.node.bottom, this.node.top] :
      [this.node.top, this.node.bottom];
  }

  // process pending links
  // and annotate shape + boundedness + names
  for(let csrId of seq){
    let crs = this.getCourse(csrId);
    if(!crs)
      continue; // suspended beds
    crs.applyPending();

    // annotations
    for(let st of crs){
      st.meta('shape', this.node.id);
      if(crs.bounded)
        st.meta('bounded', true);
      if(typeof csrId == 'string')
        st.meta(this.node, 'names', csrId);
    }
  }

  // the rest is only for numeric sequences
  if(typeof seq[0] != 'number')
    return;

  // add name annotations
  for(let name in this.courseMap){
    let crs = this.courseMap[name];
    for(let stitch of crs){
      if(!stitch)
        continue;
      stitch.meta(this.node, 'names', name);
    }
  }

  // add course and wale index annotations
  for(let i = 0; i < seq.length; ++i){
    let crsId;
    switch(this.node.numbering){
      case sk.PATTERN_UPWARD:
        crsId = i;
        break;
      case sk.PATTERN_DOWNWARD:
        crsId = seq.length - 1 - i;
        break;
      default:
        console.log('Warning: invalid flow "' + this.node.flow + '" for node ' + this.node);
        /* fall through */
      case sk.PATTERN_AUTO:
        crsId = seq[i];
        break;
    }
    const crs = this.courses[crsId];
    const stitches = crs.stitches;
    for(let j = 0; j < stitches.length; ++j){
      const stitch = stitches[j];
      stitch.meta(this.node, 'courseId', i);
      stitch.meta(this.node, 'courseEnd', seq.length-1);
      stitch.meta(this.node, 'waleId', j);
      stitch.meta(this.node, 'waleEnd', crs.length-1);
      stitch.meta(this.node, 'gauge', this.getNeedleScale());
    }
  }
};

/**
 * Trace yarn within sheet:
 * - creates course connections between courses
 * - no continuity yarn is added since sheets
 *   ensure continuity by construction
 * - enforces that orientation be encoded in
 *   location of start and end points of courses
 *
 * @param shape the sheet's shape
 * @param seq the sequence of courses to traverse
 */
function traceSheet(shape, seq){
  for(let i = 1; i < seq.length; ++i){
    let prevCrs = shape.getCourse(seq[i-1]);
    let currCrs = shape.getCourse(seq[i]);
    prevCrs.link(currCrs);
  }
}

// grid mask
const MASK = 'mask';

/**
 * Assign wales over a regular course grid.
 * The grid must be an array of courses (or bed layouts)
 * The initial course (or bed layout) must span all needles.
 *
 * The argument can use a mix of `Course` instances as well as
 * bed layouts, represented as an array of two arrays [frt, bck],
 * each of which has stitches at given needle indices.
 *
 * @param courses a list of overlapping courses (or bed layouts)
 */
function gridWales(...courses){
  // compute regular grid layout
  const grids = courses.map(crs => {
    if(Array.isArray(crs) && crs.length === 2)
      return crs;
    else
      return crs.toBeds();
  });
  // note: grids = Array[#courses][2][GridWidth]
  const gridWidth = grids.reduce((max, beds) => Math.max(max, beds[0].length), 0);
  // assert(grids.every(beds => beds[0].length === gridWidth), 'Grid has irregular rows');
  // for both sides
  for(let s = 0; s < 2; ++s){
    // for each column
    for(let c = 0; c < gridWidth; ++c){
      let last = null;
      // direct wales from bottom to top
      for(let r = 0; r < grids.length; ++r){
        let curr = grids[r][s][c];
        if(!curr)
          continue;
        if(curr == MASK)
          last = null; // mask connection
        if(last){
          last.wale(curr);
        }
        last = curr;
      } // endfor r (rows)
    } // endfor c (cols)
  } // endfor s (sides)
}

/**
 * Transform the first reversing course stitch
 * into a Tuck so as to collapse local connections
 * and reduce the size of holes.
 *
 * The Tuck is applied on the backward course.
 *
 * @param foreCrs the outward course
 * @param backCrs the inward course wich receives the tuck
 */
function applyTuck(foreCrs, backCrs){
  let stitch = backCrs.stitches.find(s => {
    return s.findCourse(n => foreCrs.hasStitch(n));
  });
  assert(stitch, 'No course link between two consecutive courses');
  if(stitch)
    stitch.pattern = Pattern.TUCK;
}

/**
 * Trace yarn within a joint shape.
 * - creates additional stitches for continuous knitting
 * - binds them with course connections
 * - adds wale connections across the grid of stitches
 *
 * @param shape the joint shape
 * @param seq the sequence of courses to trace
 */
function traceJoint(shape, seq){
  // course binding using
  // - generalized binding for transitions
  // - direct binding between short rows

  // first transition
  let lastCrs = shape.getCourse(seq[0]);
  let contCrs = shape.getCourse(seq[1]);
  let currCrs = shape.getCourse(seq[2]);
  lastCrs.continuityBind(currCrs, contCrs, lastCrs);
  if(contCrs.length)
    applyTuck(contCrs, currCrs);
  // applyTuck(contCrs.length ? contCrs : lastCrs, currCrs);

  // between short rows
  const N = seq.length;
  for(let r = 3; r < N - 2; ++r){
    lastCrs = shape.getCourse(seq[r-1]);
    currCrs = shape.getCourse(seq[r]);
    lastCrs.directBind(currCrs);
    applyTuck(lastCrs, currCrs);
  }

  // last transition
  lastCrs = shape.getCourse(seq[N - 3]);
  contCrs = shape.getCourse(seq[N - 2]);
  currCrs = shape.getCourse(seq[N - 1]);
  lastCrs.continuityBind(currCrs, contCrs, currCrs); // Course.INVERSE);
  applyTuck(lastCrs, contCrs.length ? contCrs : lastCrs);

  // create wales
  gridWales(...shape.courses);

  // normalize courses
  // let last = shape.getCourse(seq[0]);
  for(let i = 1; i < seq.length; ++i){
    let curr = shape.getCourse(seq[i]);
    if(curr.isEmpty()){
      // remove empty courses (continuity)
      // from course sequence
      seq.splice(i, 1);
      --i;
    }
    // /!\ not suspending stitches from previous course
    // this is now done during the stitch interpretation
    // since suspending happens by default thanks to the wales
    //   suspend Stitches(last, curr);
    //   last = curr;
  }
}

/**
 * Trace the yarn in a split shape.
 * This accounts to creating the correct course connections
 * given the direction of traversal and adding necessary continuity stitches.
 *
 * @param shape the split shape
 * @param seq the traversal order
 */
function traceSplit(shape, seq){
  // we only trace at the transition point
  if(seq.length != 3)
    return;

  // find branch name
  const braIdx = seq.find(n => n != 'base' && n != 'continuity');

  // the course and interface we are processing
  let baseCrs = shape.getCourse('base');
  let contCrs = shape.getCourse('continuity');
  let branCrs = shape.getCourse(braIdx);

  // 1 = create virtual branch courses on the branch side
  let waleGrid = [[], []]; // for wales
  for(let b = 0; b < shape.node.branches.length; ++b){
    const braName = 'branches/' + b;
    const crs = shape.getCourse(braName);
    // skip empty branches when tracing from branches
    // unless it's the starting branch
    if(seq[0] !== 'base' && b != braIdx){
      const itf = shape.node.branches[b];
      if(!itf.isConnected()){
        continue; // skip its unnecessary stitches
      }
    }
    for(let j = 0; j < crs.stitches.length; ++j){
      const stitch = crs.stitches[j];
      const { index, side } = crs.needleOf(stitch);
      assert(!waleGrid[side][index], 'Overlapping stitches');
      waleGrid[side][index] = stitch;
    }
  }

  // 2 = bind base and main branch
  if(seq[0] == 'base'){
    // from base
    baseCrs.continuityBind(branCrs, contCrs, baseCrs);
  } else {
    // from branch
    branCrs.continuityBind(baseCrs, contCrs, baseCrs);
  }

  // 4 = create wale connection
  gridWales(baseCrs, contCrs, waleGrid);

  // 5 = pack courses uniformly depending on direction
  if(seq[0] === 'base'){
    // 5a = from base
    //    => branch stitches will only appear
    //       when they are processed later
    //    => do not include their stitches (use special bindCrs)
    //
    // we simplify the layout by using the binding course as output
    // instead of the original branch course (with different size)
    // = use full-width branch
    shape.setCourse('branch', branCrs);
    // rename to generic "branch"
    let seqIdx = seq.indexOf(braIdx);
    assert(seqIdx !== -1, 'Branch is missing');
    shape.setCourseInterface('branch', seq[seqIdx]); // remember interface
    seq[seqIdx] = 'branch';

    // simplify course schedule and suspend stitches upward
    /*
    if(!contCrs.length){
      seq.splice(1, 1); // remove continuity if it's empty
      suspendStitches(baseCrs, bindCrs); // from base to branch (no cont)
    } else {
      suspendStitches(baseCrs, contCrs); // from base to continuity
      suspendStitches(contCrs, bindCrs); // from continuity to branch
    } */

  } else {
    // 5b = from branch
    //    => transfer branch stitches to continuity course for layout ease
    //    => constrain the location more tightly as a "single" component
    //    + remove course branch
    //
    // note: we remove the course branch because that one should have correct
    // suspended stitches => multiple components upon creation
    // Furthermore, that course is always redundant => not ever necessary

    // i) add branch stitches on continuity course (if not empty)
    if(contCrs.length === 0){
      seq.splice(1, 1); // remove continuity if it's empty
      // nothing to suspend (since only the base course is scheduled)
    }
    /* else {
      suspendStitches(waleCrs, contCrs); // from all branches to continuity
    } */

    // ii) replace branch course with initial suspended bed
    seq[0] = 'waleGrid';
    shape.setBeds('waleGrid', waleGrid); // special wale connections
  }
}

function traceCustom(shape, seq){
  assert(seq.length, 'Empty custom shape?');

  // custom shape
  const node = shape.node;
  const { courses, srcmasks, trgmasks, bindings } = node.eval();
  const forward = !seq[0];

  // clear the cache, so we don't get access to these stitches through the cache
  node.clearCache();

  // compute actual bindings
  let last = { type: 'shaper', args: ['uniform'] }; // defaults to uniform shaping
  for(let i = bindings.length - 1; i >= 0; --i){
    if(!bindings[i])
      bindings[i] = last;
    else
      last = Object.assign({}, bindings[i]);
  }

  // trace yarn in sequence order
  const gridStack = [[courses[seq[0]]]];
  for(let i = 1; i < seq.length; ++i){
    const t0 = seq[i-1];
    const t1 = seq[i];
    const ti = Math.min(t0, t1);
    // actual courses
    const lastCrs = courses[t0];
    const currCrs = courses[t1];
    if(!lastCrs || !currCrs){
      // some beds data => no binding necessary?
      continue;
    }
    // circular ?
    const circular = lastCrs.cicrcular && currCrs.circular;
    // masking
    const lastMask = (forward ? srcmasks[ti] : trgmasks[ti]);
    const currMask = (forward ? trgmasks[ti] : srcmasks[ti]);
    const maskBeds = (crs, mask) => {
      if(!mask)
        return crs.toBeds();
      const [front, back] = crs.toBeds();
      return [
        front.map(s => s && s.id in mask ? MASK : s), // replace masked stitches with MASK
        back.map(s  => s && s.id in mask ? MASK : s)
      ];
    };
    // get binding type
    const { type, args } = bindings[ti];
    switch(type.toLowerCase()){

      case 'spread': {
        const [ factor = 1 ] = args;
        lastCrs.spread(currCrs, factor);
      } break;

      case 'pgrid':
        args.unshift(Shaper.NONE);
        gridStack.push([
          maskBeds(lastCrs, lastMask),
          maskBeds(currCrs, currMask)
        ]);

        /* fall through */
      case 'shaper': {
        gridStack.push([]);
        const [ shaper = 'uniform' ] = args;
        const lastStitches = lastMask ? lastCrs.stitches.filter(s => !(s.id in lastMask)) : lastCrs.stitches;
        const currStitches = currMask ? currCrs.stitches.filter(s => !(s.id in currMask)) : currCrs.stitches;
        Shaper.apply(shaper, [lastStitches, currStitches], circular);
        lastCrs.link(currCrs);
      } break;

      case 'grid': {
        // simple binding
        lastCrs.link(currCrs);
        // add to gridWales targets
        const grids = gridStack[gridStack.length - 1];
        if(!grids.length)
          grids.push(maskBeds(lastCrs, lastMask));
        grids.push(maskBeds(currCrs, currMask));
      } break;

      default: {
        // continuity binding
        const contCrs = Course.empty(circular);
        lastCrs.continuityBind(currCrs, contCrs, ...args);
        // if continuity course used, insert in sequence
        if(!contCrs.isEmpty()){
          const contName = 'cont-' + i;
          seq.splice(i, 0, contName);
          shape.setCourse(contName, contCrs); // named course to not disturb numbered sequence
        }
        // add to gridWales targets
        const grids = gridStack[gridStack.length - 1];
        if(!grids.length)
          grids.push(maskBeds(lastCrs, lastMask));
        grids.push(contCrs);
        grids.push(maskBeds(currCrs, currMask));
      } break;
    }
  }

  // apply gridWales to necessary groups
  for(let grids of gridStack){
    if(grids.length > 1){
      gridWales(...grids);
    }
  }
}

/**
 * Get all reacheable nodes from one source node and starting path
 *
 * @param root the starting node
 * @param path the starting interface
 * @return a list of sides { node, path }
 */
function getReachableNodes(root, path) {
  let nodes = [];
  let nodeMap = {};
  let queue = [ {node: root, path} ];
  while(queue.length){
    let side = queue.pop();
    if(side.node.id in nodeMap)
      continue;
    // register
    nodeMap[side.node.id] = true;
    nodes.push(side);
    // queue all the interface's other sides
    side.node.getInterfaces().forEach(itf => {
      let other = itf.otherSide(side.node);
      if(other && other.node)
        queue.push({ node: other.node, path: other.path });
    });
  }
  return nodes;
}

Shape.startableInterfaceOf = function(node){
  return node.getInterfaces().find(itf => {
    let path = itf.thisSide(node).path;
    return !itf.isConnected() && path != 'left' && path != 'right';
  });
};

Shape.prototype.getStartInterface = function(){
  return Shape.startableInterfaceOf(this.node);
};
Shape.prototype.getStartInterfaces = function(){
  return this.node.getInterfaces().filter(itf => {
    let path = itf.thisSide(this.node).path;
    return !itf.isConnected() && path != 'left' && path != 'right';
  });
};

Shape.assemble = function(root, path){
  let t = Timer.create();

  // get groups of connected nodes
  let groups = [ getReachableNodes(root, path) ];
  let nodeMap = {};
  for(let { node } of groups[0]){
    nodeMap[node.id] = true;
  }
  let queue = env.nodes.filter(n => {
    return !(n.id in nodeMap) && Shape.startableInterfaceOf(n);
  });
  while(queue.length){
    let node = queue.shift();
    // skip if already processed
    if(node.id in nodeMap)
      continue;
    // generate new group
    let itf = Shape.startableInterfaceOf(node);
    assert(itf, 'No startable interface');
    let sides = getReachableNodes(node, itf.thisSide(node).path);
    for(let { node } of sides)
      nodeMap[node.id] = true;
    groups.push(sides);
  }
  t.measure('groups');

  // build all groups of shapes
  if(env.verbose)
    console.log(groups.length + ' groups of connected components');
  let shapeGroups = [];
  for(let sides of groups){
    if(env.verbose)
      console.log('Assembling ' + sides.length + ' shapes from ' + root + '/' + path);

    // build individual shapes
    let shapes = sides.map(side => Shape.build(side.node, side.path));

    // create shape map and gather interfaces
    let shapeMap = {};
    let interList = [];
    let interMap = {};
    for(let s of shapes){
      shapeMap[s.node.id] = s;
      for(let itf of s.node.getInterfaces()){
        // skip if already mapped
        if(itf.id in interMap)
          continue;
        interList.push(itf);
        interMap[itf.id] = true;
      }
    }

    // assemble shapes at interfaces
    if(env.verbose)
      console.log('Processing ' + interList.length + ' interfaces');
    for(let itf of interList){
      if(itf.isConnected()){
        // bind two courses
        let s0 = itf.sides[0];
        let s1 = itf.sides[1];
        Shape.bind(shapeMap[s0.node.id], s0.path, shapeMap[s1.node.id], s1.path);

      } else if(itf.state != sk.OPEN && itf.state != sk.CONNECTED){
        // close course if it is open
        let side = itf.sides[0];
        let shape = shapeMap[side.node.id];
        let course = shape.getCourse(side.path);
        if(course && course.circular){
          if(env.verbose)
            console.log('Closing ', shape.node.id, '/', side.path, ' as ', itf.state);
          course.close(itf.state == sk.CLOSED ? Course.COLLAPSED : itf.state);
        }
      }
    } // endfor itf of interList
    shapeGroups.push(shapes);
  } // endfor sides of groups
  t.measure('bind');

  // output timing information
  console.log('Assembly timing', t.toString());
  return shapeGroups;
};

module.exports = Shape;
