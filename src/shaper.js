// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const DSL = require('./dsl.js');

// constants
const sh = {
  NONE:    'none',
  UNIFORM: 'uniform',
  LEFT:    'left',
  RIGHT:   'right',
  CENTER:  'center',
  SIDES:   'sides',
  FRONT_SIDES: 'frontsides',
  BACK_SIDES:  'backsides',
  THREE_SIDES: 'threesides',
  DEFAULT:     'default',
  predefined: (function(){
    return {
      none: () => {},
      uniform: uniformShaper,
      left:    leftShaper,
      right:   rightShaper,
      center:  centerShaper,
      sides:   sidesShaper,
      frontsides: frontSidesShaper,
      backsides:  backSidesShaper,
      threesides: threeSidesShaper,
      'default': defaultShaper
    };
  })()
};

function defaultCheck(M, N){
  assert(M && N && (N - M) >= 0 && (N - M) <= M, 'Invalid shaping from ' + M + ' to ' + N);
}

function uniformShaper(M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  let ratio = N / M;
  let j1 = Math.round(i * ratio);
  let j2 = Math.round((i + 1) * ratio);
  assert(j2 - j1 <= 2 && j2 - j1 >= 1, 'Ratio is invalid');
  if(j2 == j1 + 1)
    mapTo(i, j1);
  else
    splitInto(i, j1, j1+1);
}
/*
function uniformBlockShaper(blocks, M, N, i, mapTo, splitInto){
  let src = Array.from({ length: M });
  let trg = Array.from({ length: N });
  let splitRegions = blocks.filter(blk => blk).length;
  let d = N - M;
}
*/
/**
 * Left shaper allocating splits on the left
 */
function leftShaper(M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  let d = N - M;
  if(i < d)
    splitInto(i, 2*i, 2*i+1); // i -> (2*i, 2*i+1)
  else
    mapTo(i, i+d); // i -> i+d
}
/**
 * Right shaper allocating splits on the right
 */
function rightShaper(M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  let d = N - M;
  let o = M - d;
  if(i >= o)
    splitInto(i, o + 2*(i-o), o + 2*(i-o) + 1); // i -> (2*i, 2*i+1)
  else
    mapTo(i, i); // i -> i
}
/**
 * Center shaper allocating splits in the center
 */
function centerShaper(M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  let d = N - M;
  let o1 = Math.round(M/2 - d/2);
  let o2 = o1 + d;
  if(i < o1)
    mapTo(i, i);
  else if(i < o2)
    splitInto(i, o1 + 2*(i-o1), o1 + 2*(i-o1) + 1); // i -> (2*i, 2*i+1)
  else
    mapTo(i, i+d); // i -> i+d
}
/**
 * Side shaper allocating splits on both left and right
 */
function sidesShaper(M, N, i, mapTo /*, splitInto */){
  defaultCheck(M, N);
  let d = N - M;
  // split source counts
  let m1 = Math.ceil(d/2);
  let m2 = d-m1;
  // split target counts
  let n1 = m1*2;
  let n2 = m2*2;

  if(i < m1){
    // left side
    if(i*2 < n1)
      mapTo(i, i*2);
    if(i*2+1 < n1)
      mapTo(i, i*2+1);
  } else if(M-1-i < m2){
    // right side as mirror of left
    let j = M-1-i;
    if(j*2 < n2)
      mapTo(M-1-j, N-1-j*2);
    if(j*2+1 < n2)
      mapTo(M-1-j, N-2-j*2);
  } else {
    // shifted singletons
    mapTo(i, n1 + i - m1);
  }
}
/**
 * Front side shaper allocating splits on the left and center left
 */
function frontSidesShaper(M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  assert(N-M <= M/2, 'Cannot use front sides with M=' + M + ' and N=' + N);
  let m1 = Math.ceil(M/2);
  let m2 = M - m1;
  let n1 = N-m2;
  // let n2 = m2;
  if(i<m1){
    sidesShaper(m1, n1, i, mapTo, splitInto);
  } else {
    mapTo(i, n1+i-m1);
  }
}
/**
 * Back side shaper allocating splits on the right and center right
 */
function backSidesShaper(/* M, N, i, mapTo, splitInto */){
  // TODO implement
}
/**
 * Shaper allocating splits on the left, center left and center right
 */
function threeSidesShaper(/* M, N, i, mapTo, splitInto */){
  // TODO implement
}
/**
 * Default shaper allocating splits on the left, center left, center right and right
 */
function defaultShaper(M, N, i, mapTo, splitInto){
  let d = N - M;
  // delegate depending on number of splits
  if(d == 1)
    return centerShaper(M, N, i, mapTo, splitInto);
  else if(d == 2)
    return frontSidesShaper(M, N, i, mapTo, splitInto);
  else if(d == 3)
    return threeSidesShaper(M, N, i, mapTo, splitInto);
  // this default 4-location shaper
  defaultCheck(M, N);

}

function leftAlignmentDiracShaper(band, M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  assert(N - M <= 1, 'Dirac(align=left) shaper can only work with single increases / decreases');
  
  if(i < M - band)
    mapTo(i, i);
  else
    splitInto(i, i, i+1);
}

function rightAlignmentDiracShaper(band, M, N, i, mapTo, splitInto){
  defaultCheck(M, N);
  assert(N - M <= 1, 'Dirac(align=right) shaper can only work with single increases / decreases');
  
  if(i < band)
    splitInto(i, i, i+1);
  else
    mapTo(i, i+1);
}

function centerAlignmentDiracShaper(band, M, N, i, mapTo, splitInto, mergeInto){
  defaultCheck(M, N);
  assert(N - M <= 2, 'Dirac(align=center) shaper can only work with up to two increases / decreases per row');

  let d = N - M;
  if(d == 0)
    mapTo(i, i);
  else if(d == 1)
    leftAlignmentDiracShaper(band, M, N, i, mapTo, splitInto, mergeInto);
  else {
    if(i < band)
      splitInto(i, i, i+1);
    else if(i < M - band)
      mapTo(i, i+1);
    else
      splitInto(i, i+1, i+2);
  } 
}

function createDiracShaper(alignment, band){
  if(!band) band = 1;
  switch(alignment){
    case 'left':    return leftAlignmentDiracShaper.bind(null, band);
    case 'right':   return rightAlignmentDiracShaper.bind(null, band);
    case 'center':  return centerAlignmentDiracShaper.bind(null, band);
    default:
      throw "Unsupported alignment " + alignment;
  }
}

// @see https://stackoverflow.com/questions/5999998/how-can-i-check-if-a-javascript-variable-is-function-type
function isFunction(functionToCheck) {
   return functionToCheck && {}.toString.call(functionToCheck) === '[object Function]';
}

/**
 * Compile a shaper program
 *
 * @param shaper the shaper, either as a function, or string expression
 * @return shaper function to be evaluated
 */
function compileShaper(shaper){
  if(isFunction(shaper))
    return shaper;
  if(typeof shaper == 'string' && shaper in sh.predefined)
    return sh.predefined[shaper];
  return DSL.func(shaper, ['M', 'N', 'i', 'mapTo', 'splitInto', 'mergeOnto'], DSL.shaper, 'Shaper: ');
}

function halfArray(arr, which){
  assert([0, 1].includes(which), 'Invalid half');
  assert(arr.length % 2 == 0, 'Half of odd array');
  return which ? arr.slice(0, arr.length/2) : arr.slice(arr.length/2);
}

/**
 * Apply a shaper on a sequence of stitch courses
 *
 * @param shaperStr the shaper
 * @param courses the sequence of courses
 * @param split whether to apply shader on front and back separately
 */
function applyShaper(shaperStr, courses, split){
  const shaper = compileShaper(shaperStr);
  const sides = split ? 2 : 1;
  for(let c = 1; c < courses.length; ++c){
    for(let s = 0; s < sides; ++s){
      let from = Array.isArray(courses[c-1]) ? courses[c-1] : Array.from(courses[c-1].stitches);
      let to   = Array.isArray(courses[c-0]) ? courses[c-0] : Array.from(courses[c-0].stitches);
      if(sides == 2){
        from = halfArray(from, s);
        to = halfArray(to, s);
      }
      // behaviour depends on course gradient
      if(from.length == to.length){
        // default direct mapping
        for(let i = 0; i < from.length; ++i)
          from[i].wale(to[i]);
      } else {
        // inverse shaper program
        if(from.length > to.length){
          // invert source and targets
          let tmp = from;
          from = to;
          to = tmp;
        }
        let M = from.length;
        let N = to.length;
        let mapTo = (i, j) => {
          from[i].wale(to[j]);
        };
        let splitInto = (i, j1, j2) => {
          from[i].wale(to[j1]).wale(to[j2]);
        };
        let mergeOnto = (i1, i2, j) => {
          to[j].wale(i1).wale(i2);
        };

        // execute shaper program for the two courses
        for(let i = 0; i < M; ++i)
          shaper(M, N, i, mapTo, splitInto, mergeOnto);
      }
    }
  }
}

/**
 * Test the execution of a shaper by applying it to two imaginary courses
 *
 * @param shaperStr the shaper program
 * @param M the first course's width
 * @param N the second course's width
 * @return the backward links from target to source course
 */
function testShaper(shaperStr, M, N){
  // ensure default M/N relationship
  if(M > N)
    return testShaper(shaperStr, N, M);
  let shaper = compileShaper(shaperStr);
  // create test result linking structure
  let sources = Array.from({ length: N }).map(() => []);
  let mapTo = function(i, j) {
    sources[j].push(i);
  };
  let splitInto = function(i, j1, j2) {
    sources[j1].push(i);
    sources[j2].push(i);
  };
  let mergeOnto = (i1, i2, j) => {
    sources[j].push(i1, i2);
  };
  // apply on row transition from M to N
  for(let i = 0; i < M; ++i)
    shaper(M, N, i, mapTo, splitInto, mergeOnto);
  return sources;
}


module.exports = Object.assign({
  createDirac: createDiracShaper,
  compile: compileShaper,
  apply: applyShaper,
  test: testShaper
}, sh);
