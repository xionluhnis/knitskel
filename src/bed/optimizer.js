// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const assert = require('../assert.js');
const Timer = require('../timer.js');
const env = require('../env.js');
const { BOTH_SIDES } = require('./layout.js');

function Optimizer(groups, optLevel){
  this.groups = groups;
  this.level = optLevel || 'group';
  // data structures
  this.hierarchy = [];
  this.bounds    = {};
  this.boundary_leaves = {};
  this.boundary_links  = {};
  this.stress_pairs = {};
  this.offsets   = {};
  this.conflicts = {};
  this.leaves    = [];
}

Optimizer.prototype.getStressPairsBetween = function(g1, g2) {
  const key = g1.id + '/' + g2.id;
  if(key in this.stress_pairs)
    return this.stress_pairs[key];
  else {
    const stress_pairs = getNeedleStressPairs(g1, g2);
    this.stress_pairs[key] = stress_pairs;
    return stress_pairs;
  }
};

Optimizer.prototype.getBestOffsetBetween = function(g1, g2){
  const key = g1.id + '/' + g2.id;
  if(key in this.offsets)
    return this.offsets[key];
  else {
    const sp = this.getStressPairsBetween(g1, g2);
    const offset = getNeedleStressMeanOffset(sp);
    // XXX should try variations since it's an approximation
    this.offsets[key] = offset;
    return offset;
  }
};

Optimizer.prototype.getWeightBetween = function(g1, g2) {
  return this.getStressPairsBetween(g1, g2).length;
};

Optimizer.prototype.getBedConflictsBetween = function(g1, g2) {
  const key = [g1.id, g2.id].sort().join('/');
  if(key in this.conflicts)
    return this.conflicts[key];
  else {
    const sp = this.getStressPairsBetween(g1, g2);
    const conflicts = countBedConflicts(sp);
    this.conflicts[key] = conflicts;
    return conflicts;
  }
};

Optimizer.prototype.createHierarchy = function(){
  let hierarchy = this.hierarchy = [];
  this.bounds = {};
  let queue = this.groups.map(group => {
    return { level: 0, group };
  }).reverse();
  while(queue.length){
    let { level, group } = queue.pop();
    assert(level <= hierarchy.length, 'Hierarchy skipping levels');
    if(level >= hierarchy.length)
      hierarchy.push([ group ]);
    else
      hierarchy[level].push(group);
    // push layout children in queue
    for(let g of group.groups){
      if(g.isLeaf())
        this.leaves.push(g);
      else
        queue.push({ level: level + 1, group: g });
    }

    // pre-compute information related to that group
    this.bounds[group.id] = group.boundaries();
  }
  // sort levels by time
  for(let l = 0; l < hierarchy.length; ++l){
    hierarchy[l].sort((g1, g2) => g1.time - g2.time);
  }
  return hierarchy;
};

Optimizer.prototype.getBoundaryLeaves = function(group, forward) {
  let bleaves;
  let blinks;
  if(group.id in this.boundary_leaves){
    bleaves = this.boundary_leaves[group.id];
    blinks  = this.boundary_links[group.id];
  } else {
    blinks = {};
    bleaves = group.boundaryLeaves(null, blinks);
    this.boundary_leaves[group.id] = bleaves;
    this.boundary_links[group.id]  = blinks; // XXX could we have a single global link dictionary?
  }
  // only keep boundary leaves that have at least one link in the correct direction
  let timeCompare = forward ?
    (t_grp, t_lnk) => t_grp > t_lnk   // forward  => leaves are before group
    :
    (t_grp, t_lnk) => t_grp < t_lnk;  // backward => leaves are after group
  return bleaves.filter(grp => {
    let t_grp = grp.fullTime();
    return blinks[grp.id].some(lnk => timeCompare(t_grp, lnk.fullTime()));
  });
};

/**
 * Return the mapping of links for boundary leaves
 *
 * @param group the group whose boundaries we want the links of
 * @return a mapping object
 */
Optimizer.prototype.getBoundaryLinkMap = function(group){
  assert(group.id in this.boundary_links, 'Must call getBoundaryLeaves first');
  return this.boundary_links[group.id];
};

/**
 * Optimize the offset of a given group by considering the stress at its boundaries.
 * If the group is parent of leaves, then also optimize its side.
 *
 * @param group the group to optimize the offset (and side) of
 * @param forward whether to optimize while going forward in time (or else backward)
 * @return whether the group offset (or side) changed
 */
Optimizer.prototype.optimize = function(group, forward){
  let leaves = this.getBoundaryLeaves(group, forward);
  if(leaves.length === 0)
    return false;

  // link map
  let linkMap = this.getBoundaryLinkMap(group);
  // /!\ links are bidirectional (forward and backward)
  //  => must be careful when using them!
  //  e.g. special case for groups that have single time slice

  // compute offset change as weighted best change between individual sub-pairs
  let offset = 0;
  let weight = 0;
  for(let g of leaves){
    let leafOffset = g.fullOffset();
    let leafTime = g.fullTime();
    let links = linkMap[g.id];
    assert(links.length, 'Boundary link must have at least one linked group');
    for(let lnk of links){
      // only consider links that are in the correct optimization direction
      // (special case of unit-time-slices that have both forward and backward links)
      let linkTime = lnk.fullTime();
      // link should be in opposite direction of optimization
      if((forward && linkTime > leafTime)   // forward => link should be before leaf
      || (!forward && linkTime < leafTime)) // backward => link should be after leaf
        continue; // invalid side => do not consider
      // compute current absolute offset between leaf and its link
      let linkOffset = lnk.fullOffset();
      let deltaOffset = leafOffset - linkOffset;
      // accumulate weighted relative offsets
      let w = this.getWeightBetween(g, lnk);
      let relOffset = this.getBestOffsetBetween(g, lnk) - deltaOffset;
      // XXX apply power to w? to relOffset?
      offset += relOffset * w;
      weight += w;
    }
  }
  // change only happen at integer offsets
  let bestOffsetChange = offset / Math.max(1, weight);
  let offsetChange = Math.round(bestOffsetChange);
  if(offsetChange){
    if(env.verbose)
      console.log('Offset g#' + group.id + ' by ' + offsetChange + ' (' + bestOffsetChange + ')');
    group.offset += offsetChange; // change happened!
  }

  // optimize the side only if possible
  // = can only change groups that have all leaves on one side
  // ... else we are crossing wales at the boundaries (messing orientation)
  if(group.side() == BOTH_SIDES)
    return offsetChange; // two-sided layout
  /*
  if(group.groups.some(g => g instanceof Layout))
    return offsetChange; // has some non-leaf child
  */

  // we can change this group's side
  let total_good = 0;
  let total_bad  = 0;
  for(let g of leaves){
    let links = linkMap[g.id];
    for(let lnk of links){
      let [good, bad] = this.getBedConflictsBetween(g, lnk);
      total_good += good;
      total_bad  += bad;
    }
  }
  // change bed side if the total number of good pairs is smaller than that of bad pairs
  let flipChange = total_good < total_bad;
  if(flipChange){
    group.flip = !group.flip;
    if(env.verbose)
      console.log('Switch flip of g#' + group.id + ' to ' + (group.flip ? 'flip' : 'normal'));
  }
  return offsetChange || flipChange;
};


// ###########################################################################
// ##### Stress Optimization #################################################
// ###########################################################################

/**
 * Compute the list of stress pairs between two groups
 *
 * @param grp0 the first group
 * @param grp1 the second group
 * @return a list of pairs of needles between connected / related stitches of both groups
 */
function getNeedleStressPairs(grp0, grp1){
  // create list of pairs for stress computation
  const pairs = [];
  for(let s0 of grp0.stitches()){
    let connections;
    if(grp1.hasStitch(s0)) // group.stitches.includes(s0)
      connections = [ s0 ];
    else
      connections = grp1.filterStitches(s1 => s0.isNeighbor(s1) );
    // connections = Array.from(new Set(connections));
    if(connections.length === 0)
      continue;
    // register each pair
    let n0 = grp0.needleOf(s0);
    for(let s1 of connections){
      let n1 = grp1.needleOf(s1);
      pairs.push([n0, n1]);
    }
  }
  return pairs;
}

/**
 * Compute the mean offset assumed by the needle stress pairs with another group,
 * approximating the best offset between the two groups.
 *
 * @param args two groups or a prefactorized set of stress pairs
 * @return the mean offset between needle stress pairs
 */
function getNeedleStressMeanOffset(...args){
  assert(args.length === 1 || args.length === 2, 'Invalid arguments');
  const pairs = args.length == 2 ? args[0].getNeedleStressPairs(args[1]) : args[0];
  assert(Array.isArray(pairs), 'Invalid needle pairs');
  assert(pairs.length, 'Mean offset does not exist between unrelated groups');
  let offset = 0;
  for(let [n0, n1] of pairs){
    offset += n1.index - n0.index;
  }
  offset /= pairs.length;
  return offset;
}

/**
 * Compute the bed stress between this group and another one, given flippings settings for the two groups.
 * The stress is computed as the number of connected stitches being on different beds (front vs back).
 * Connected stitches include stitch neighbors as well as repeated stitches.
 *
 * @param args two groups or a prefactorized set of stress pairs
 * @return [good, bad] where bad is the count of mismatching bed connections, and good that of the matching ones
 */
function countBedConflicts(...args){
  assert(args.length === 1 || args.length === 2, 'Invalid arguments');
  const pairs = args.length == 2 ? args[0].getNeedleStressPairs(args[1]) : args[0];
  assert(pairs.length, 'Conflicts do not exist between unrelated groups');
  let conflicts = 0;
  for(let [n0, n1] of pairs)
    if(n0.side != n1.side)
      ++conflicts;
  return [pairs.length - conflicts, conflicts];
}

function optimizeLayout(groups, optLevel){
  let opt = new Optimizer(groups, optLevel);
  if(opt.level == 'none')
    return groups; // nothing to do

  // time optimization
  let timer = Timer.create();

  // TODO transform into new groups using hints (or manual actions)

  
  // ##### Group Optimizations ###############################################

  // create group-level hierarchy
  let hierarchy = opt.createHierarchy();

  // debug hierarchy
  if(env.verbose){
    for(let l = 0; l < hierarchy.length; ++l){
      let level = hierarchy[l];
      console.log('Hierarchy level #' + l);
      for(let g of level){
        if(g.isLeaf()){
          console.log('g#' + g.id + ' leaf');
          if(g.shape)
            console.log('- crs', g.shape.node.toString(), '/', g.crsId);
          if(g.suspended.length)
            console.log('- susp', g.suspended.length);
        } else {
          if(g.first().shape)
            console.log('g#' + g.id + ' ' + g.first().shape.node.toString(), g.first().crsId + ' -> ' + g.last().crsId);
          else
            console.log('g#' + g.id + ' (len=' + g.groups.length + ') suspended');
        }
      } // endfor g
    } // endfor l
  } // endif

  // update transitions until they stabilize
  let forward = true;
  let changes = [];
  let iter = 0;
  const maxIter = 20;
  do {
    if(env.verbose)
      console.log('Iteration ' + iter + ', ' + (forward ? 'forward' : 'backward'));
    // updates per level (from coarsest to finest)
    let changeCount = 0;
    for(let l = 0; l < hierarchy.length; ++l){
      let level = hierarchy[l];
      let start = forward ? 0 : level.length - 1;
      let delta = forward ? 1 : -1;
      let end   = level.length - 1 - start + delta;
      for(let i = start; i != end; i += delta){
        let grp = level[i];
        // apply optimization to group
        let ch = opt.optimize(grp, forward);
        // record change
        if(ch)
          ++changeCount;
      }
    }
    changes.push(changeCount);
    iter = changes.length;
    // inverse direction?
    forward = !forward;

    // stopping after too many iterations
    if(iter > maxIter){
      console.log('Bed allocation did not converge after too many iterations (' + maxIter + ')');
      break;
    }
    // as long as one of the two last passes was not stable
  } while(iter < 2 || changes[iter-1] || changes[iter-2]);

  timer.measure('group');

  // ##### Bed Optimizations #################################################

  if(env.verbose)
    console.log('Optimization profile:', changes);
  console.log('Optimization timing:', timer.toString());

  return groups;
}

module.exports = Object.assign(optimizeLayout, {
  getNeedleStressPairs, getNeedleStressMeanOffset, countBedConflicts
});
