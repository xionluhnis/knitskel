// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const ContextMenu = require('./contextmenu.js');
const { editCustom } = require('./custom.js');
const Function1D = require('../fun1d.js');
const Parameter = require('../param.js');
const { editPattern } = require('./pattern.js');
const env = require('../env.js');
const sk = require('../skeleton.js');

function renderSkeleton(...args){
  require('./skeleton.js').renderSkeleton(...args);
}
function createNode(...args){
  return require('./skeleton.js').createNode(...args);
}

function askForString(message, value){
  // XXX use a nicer UI than the browser prompt!
  let str = prompt(message, value || '');
  return new Promise((resolve, reject) => {
    if(str !== null)
      resolve(str);
    else
      reject();
  });
}

function askForNumber(message, value, constraints){
  let str = prompt(message, value);
  return new Promise((resolve, reject) => {
    if(str !== null){
      let num;
      if('integer' in constraints)
        num = parseInt(str);
      else
        num = parseFloat(str);
      if('min' in constraints)
        num = Math.max(constraints.min, num);
      if('max' in constraints)
        num = Math.min(constraints.max, num);
      resolve(num);
    } else
      reject();
  });
}

function getNodeNeighbors(node) {
  return node.getInterfaces().map(itf => {
    let other = itf.otherSide(node);
    if(other)
      return other.node;
    else
      return null;
  }).filter(n => n);
}

function getPathsBetween(src, trg){
  return src.getInterfaces().filter(itf => {
    let other = itf.otherSide(src);
    return other && other.node == trg;
  }).map(itf => {
    return [itf.thisSide(src).path, itf.thisSide(trg).path];
  })[0];
}

const noop = () => {};


function createElement(tag, clazz, text){
  let el = document.createElement(tag);
  if(Array.isArray(clazz)){
    for(let c of clazz)
      el.classList.add(c);
  } else
    el.className = clazz;
  if(text)
    el.textContent = text;
  return el;
}

function capitalize(str){
  return str.replace(/^\w/, c => c.toUpperCase());
}

module.exports = {

// ###########################################################################
// ##### Tooltip #############################################################
// ###########################################################################

  tooltip(context){
    const t = this.tooltipContainer;

    // clear current tooltip
    t.classList.add('hidden');

    // clear content
    while(t.firstChild)
      t.removeChild(t.firstChild);

    // clear pending timeout
    let timeout = t.getAttribute('data-timeout');
    clearTimeout(timeout);

    // potentially trigger new tooltip
    if(context){
      timeout = setTimeout(() => {
        this.showTooltip(context);
      }, 200);
      t.setAttribute('data-timeout', timeout);
    }
  },

  showTooltip(context){
    const t = this.tooltipContainer;
    t.classList.remove('warning');
    if(typeof context == 'string'){
      t.textContent = context;
    } else {
      let { groups = [], stitch = null } = context;
      assert(groups.length, 'Needs at least one group if passing a context');
      if(Array.isArray(stitch)){
        // layout conflict
        t.classList.add('warning');
        t.appendChild(createElement('span', 'warning', 'Layout conflict between ' + stitch.length + ' layout groups'));
      } else {
        // group information
        let g = groups[0];
        if(g.shape){
          t.appendChild(createElement('span', 'node', '#' + g.shape.node.id + ' - ' + g.shape.node.name));
          /*if(stitch){
            t.appendChild(createElement('span', 'stitch', 'Pattern ' + stitch.pattern));
          }*/
        } else {
          t.appendChild(createElement('span', 'suspended', 'Suspended group'));
        }
      }
    }

    // make visible near mouse
    t.classList.remove('hidden');
    let width = t.offsetWidth + 4;
    let height = t.offsetHeight + 4;
    let winWidth = window.innerWidth;
    let winHeight = window.innerHeight;

    // positioning
    if((winWidth - this.clientX) < width){
      t.style.left = (winWidth - width) + 'px';
    } else {
      t.style.left = (this.clientX + 2) + 'px';
    }
    if((winHeight - this.clientY) < height){
      t.style.top = (winHeight - height) + 'px';
    } else {
      t.style.top = (this.clientY + 2) + 'px';
    }
  },

  // ###########################################################################
  // ##### Context Menu ########################################################
  // ###########################################################################

  getMenu(){
    // aggregate context from highlight and selection
    let context = [... new Set(this.highlight.concat(this.selection))];
    switch(context.length){
      case 0:   return this.globalActions();
      case 1:   return this.singleActions(context[0]);
      default:  return this.multipleActions(context);
    }
  },



  /**
   * Menu with global actions:
   * - create node (each type in submenu)
   * - create user parameter
   * - update user parameter (listed in submenu)
   * - load skeleton
   * - save skeleton
   * - generate DAT
   */
  globalActions(){
    const create = (text, type, params) => {
      return {
        text, icon: '<i class="' + type + '"></i>', event: () => {
          // load skeleton function only now (else does not exist yet)
          createNode(type, params);
        }
      };
    };
    const userParamMenu = Parameter.getUserParameters().map(up => {
      return {
        text: up.name + ' = ' + up.value, event: () => {
          askForString('New value for ' + up.name, up.value).then(value => {
            up.value = value;
            renderSkeleton(true);
          }).catch(noop);
        }
      };
    });
    if(Parameter.getUserParameters().some(up => up.references.size == 0)){
      userParamMenu.push(ContextMenu.DIVIDER, {
        text: 'Remove Unused', event: () => {
          for(let up of Parameter.getUserParameters()){
            Parameter.removeUserParameter(up.name); // no-op when has references
          }
        }
      });
    }
    let exportMenu = [];
    if(this.exportSVG){
      exportMenu.push({
        text: 'Export Scene', event: () => {
          this.exportSVG();
        }
      }, ContextMenu.DIVIDER);
    }
    return [
      { text: 'Create a &hellip;', menu: [
        create('Flat Sheet', sk.SHEET, { type: sk.FLAT }),
        create('Tubular Sheet', sk.SHEET, { type: sk.CYLINDER }),
        create('Joint', sk.JOINT),
        create('Split', sk.SPLIT),
        create('Custom', sk.CUSTOM)
      ] },
      ContextMenu.DIVIDER,
      { text: 'Create Parameter', event: () => {
        askForString('Parameter name').then(name => {
          Parameter.getUserParameter(name, true); // create
          renderSkeleton(true); // update skeleton
        }).catch(noop);
      } },
      { text: 'Update Parameter', menu: userParamMenu, disabled: Parameter.getUserParameters().length == 0 },
      ContextMenu.DIVIDER,
      ...exportMenu,
      { text: 'Load Skeleton', event: (event) => {
        document.getElementById('load').click(event);
      } },
      { text: 'Save Skeleton', event: (event) => {
        document.getElementById('save').click(event);
      } },
      { text: 'Generate DAT', event: (event) => {
        document.getElementById('output_save').click(event);
      } }
    ];
  },

  singleActions(group){
    const shape = group.first().shape;
    if(!shape)
      return [ 'No available action' ];
    const node = shape.node;

    // check if targetting a non-ambiguous interface side with a non-interface
    // course available for more general actions (e.g. not short splits)
    const t_s = group.first().time;
    const t_e = group.last().time;
    let itfs = [];
    if(group.groups.length > 2){
      if(this.targetTime == t_s && this.targetTime != t_e){
        itfs = shape.itfs[0];
      } else if(this.targetTime != t_s && this.targetTime == t_e){
        itfs = shape.itfs[1];
      }
    }
    if(!Array.isArray(itfs))
      return this.interfaceActions(shape, itfs, true);
    else if(itfs.length)
      return itfs.map(itf => this.interfaceActions(shape, itf));
    else
      itfs = node.getInterfaces();

    // ambiguous or not an interface => show node params + interfaces
    return [
      ...this.nodeActions(node),
      ContextMenu.DIVIDER,
      ...itfs.map(itf => this.interfaceActions(shape, itf))
    ];
  },

  nodeActions(node) {
    const selectNode = require('./params');
    // easily editable properties
    const props = Object.getPrototypeOf(node).descriptors.map(desc => {
      return node.parameters[desc.name];
    }).filter(p => {
      return p.type == Parameter.BOOLEAN
         ||  p.type == Parameter.NUMBER
         || (p.type == Parameter.STRING && p.constraints.within)
         ||  p.type == Parameter.FUN1D;
    });
    if(node.category == sk.NODE_SPLIT)
      props.push('degree'); // special case
    if(node.category != sk.NODE_CUSTOM)
      props.push(node.parameters.gauge); // extra
    const nodeLabel = capitalize(node.category) + ' #' + node.id + ' - ' + node.name;
    const menu = [
      { text: nodeLabel, menu: [
        { text: 'Edit Name', event: () => {
          askForString('New name', node.name).then(name => {
            node.name = name;
          }).catch(noop);
        }},
        { text: 'Edit Parameters', event: () => {
          selectNode(node);
        }},
        { text: 'Edit Pattern', event: () => {
          editPattern(node.id, 0);
        }},
        ContextMenu.DIVIDER,
        { text: 'Delete Node',
          disabled: env.nodes.length == 1,
          event: () => {
          const { deleteNode } = require('./skeleton.js');
          deleteNode(node);
          renderSkeleton(true);
        } }
        // XXX Duplicate node
      ] },
      ContextMenu.DIVIDER,
      ...props.map(p => this.propertyActions(node, p))
    ];
    if(node.category == sk.NODE_JOINT){
      menu.push(ContextMenu.DIVIDER);
      menu.push({ text: 'Smart heel', event: () => {
        const botWidth = node.bottom.getSize(); // getSize('bottom');
        const topWidth = node.top.getSize(); // getSize('top');
        askForNumber('Base heel width', Math.max(botWidth, topWidth),
          { integer: true, min: 2 }).then(baseWidth => {
          askForNumber('Middle heel width', Math.max(2, Math.floor(baseWidth/2)),
            { integer: true, min: 2, max: baseWidth }).then(middleWidth => {
              assert(middleWidth <= baseWidth, 'Invalid middle width');
              // set width function
              node.width = [0, baseWidth, 0.5, middleWidth, 1, baseWidth];
              // compute necessary length
              // to have continuous 1-stitch decreases (to middle)
              // and increases (from middle) of the heel
              node.rows = Math.max(2, 2 * (baseWidth - middleWidth + 1));
              // update
              renderSkeleton(true);
            }).catch(noop);
        }).catch(noop);
      }});
    } else if(node.category == sk.NODE_CUSTOM){
      // menu.push(ContextMenu.DIVIDER);
      menu.push({ text: 'Edit code', event: () => {
        editCustom(node.id);
      }});
      // user parameters
      for(let param of node.getUserParameters()){
        menu.push({ text: param.name + '<span class="value">' + param.value + '</span>',
          event: () => {
          askForString('Value of ' + param.name, param.value).then(expr => {
            let prevValue = param.value;
            try {
              // user input may be invalid
              param.update(expr);
              param.eval();
            } catch(err){
              // use previous value that worked
              param.update(prevValue);
              return; // XXX show message to user?
            }
            renderSkeleton(true);
          }).catch(noop);
          }});
      }
      menu.push(this.propertyActions(node, node.parameters.gauge));
    }
    // expert properties
    menu.push({
      text: '(advanced)',
      menu: sk.advancedParams.map(name => {
        return this.propertyActions(node, node.parameters[name]);
      })
    });
    return menu;
  },

  propertyActions(node, param){
    if(param == 'degree')
      return this.degreeActions(node);
    const asParam = () => {
      return { text: 'As parameter', disabled: param.expr, event: () => {
        askForString('Parameter name for ' + param.name + '(=' + param.value + ')', 'MyParam').then(pname => {
          let prevValue = param.value;
          // clean parameter
          pname = pname.replace(/(#|\s)/g, '');
          if(!pname.length)
            return;
          try {
            let up = Parameter.getUserParameter(pname, true);
            up.value = param.value;
            // user input may be invalid
            param.update('#' + pname);
            param.eval();
          } catch(err){
            // use previous value that worked
            param.update(prevValue);
            return; // XXX show message to user?
          }
          renderSkeleton(true);
        }).catch(noop);
      }};
    };
    const setExpr = () => {
      return { text: 'Set expression', event: () => {
        askForString('Value of ' + param.name, param.value).then(expr => {
          let prevValue = param.value;
          try {
            // user input may be invalid
            param.update(expr);
            param.eval();
          } catch(err){
            // use previous value that worked
            param.update(prevValue);
            return; // XXX show message to user?
          }
          renderSkeleton(true);
        }).catch(noop);
      }};
    };
    let menu;
    switch(param.type){
      case Parameter.BOOLEAN:
        menu = [
          { text: 'Set to true', disabled: param.value === true, event: () => {
            param.update(true);
            renderSkeleton(true);
          } },
          { text: 'Set to false', disabled: param.value === false, event: () => {
            param.update(false);
            renderSkeleton(true);
          } }
        ];
        break;

      case Parameter.STRING:
        assert(param.constraints.within, 'General strings cannot be edited');
        menu = param.constraints.within.map(str => {
          return {
            text: str, disabled: param.value == str,
            event: () => {
              param.update(str);
              if(param.name == 'gauge' && node.category == sk.NODE_SHEET){
                // adapt width accordingly
                let scale = str == sk.FULL_GAUGE ? 2 : 0.5;
                let p = node.parameters.width;
                if(p.expr)
                  p.update(p.expr + '*' + scale);
                else
                  node.width = node.width.scaled(scale);
              }
              renderSkeleton(true);
            }
          };
        });
        break;

      case Parameter.NUMBER:
        menu = [
          { text: 'Set number', event: () => {
            askForNumber('New value of ' + param.name,
              param.value, param.constraints).then(value => {
              param.update(value);
              renderSkeleton(true);
            }).catch(noop);
          } }
        ];
        break;

      case Parameter.FUN1D: {
        let fun = param.safeEval() || Function1D.from(10);
        menu = [
          { text: 'Set constant', event: () => {
            askForNumber('Constant value of ' + param.name,
              fun.max(), { integer: true, min: 2 }).then(value => {
              param.update(value);
              renderSkeleton(true);
            }).catch(noop);
          } },
          { text: 'Interpolate between', event: () => {
            // figure out correct order so the numbers go from bottom of
            // layout to the top (not the interface names!)
            let { groups = null } = this.data.nodeMap[node.id];
            if(!groups){
              console.log('Cannot set interpolation for param ' + param.name + ' of ' + node);
              return;
            }
            askForString('List of values separated by ","',
              fun.values().join(',')).then(str => {
              let values = str.split(',').map(strNumber => Math.max(2, parseInt(strNumber)));
              // check it's safe to use
              if(!values.length && values.some(n => Math.isNaN(n)))
                return;
              // update value
              if(values.length == 1)
                param.update(values[0]);
              else {
                // ordering
                if(groups[groups.length-1].crsId == 0){
                  values = values.reverse(); // bottom is at the top of the layout
                }
                let fun = values.reduce((arr, val, idx) => {
                  arr.push(idx / (values.length - 1));
                  arr.push(val);
                  return arr;
                }, []);
                param.update(fun);
              }
              renderSkeleton(true);
            }).catch(noop);
          } }
        ];
      } break;

      default:
        return '<i>' + param.name + '?</i>';
    }
    menu.push(ContextMenu.DIVIDER, asParam(), setExpr());
    return {
      text: param.name + '<span class="value">' + param.value + '</span>',
      menu
    };
  },

  degreeActions(node){
    return {
      text: 'degree<span class="value">' + node.degree + '</span>',
      event: () => {
        askForNumber('New split degree',
          node.degree, { integer: true, min: 2 }).then(value => {
          node.degree = value;
          renderSkeleton(true);
        }).catch(noop);
      }
    };
  },

  interfaceActions(shape, itf, onlyActions) {
    const node = shape.node;
    const thisPath = itf.thisSide(node).path;
    const otherSide = itf.otherSide(node);
    const actions = [];
    if(itf.isConnected()){
      actions.push({
        text: 'Disconnect', event: () => {
          itf.disconnect();
          renderSkeleton(true);
        }
      });
    } else {
      // choosing as root
      if(['bottom', 'top'].includes(thisPath) && [sk.SHEET, sk.JOINT].includes(node.category)){
        let currStart = env.getStartSide();
        actions.push({
          text: 'Use as start',
          disabled: currStart && currStart.node == node && currStart.path == thisPath,
          event: () => {
            env.setStartSide(node, thisPath);
            renderSkeleton(true);
          }
        });
      }
      // setting state
      for(let state of [sk.OPEN, sk.CLOSED]){
        actions.push({
          text: 'Set to ' + capitalize(state),
          disabled: itf.state == state,
          event: () => {
            itf.state = state;
            renderSkeleton(true);
          }
        });
      }
      actions.push(ContextMenu.DIVIDER);

      // cast on/off
      actions.push(this.propertyActions(itf, itf.parameters.caston));
      actions.push(this.propertyActions(itf, itf.parameters.castoff));
      actions.push(ContextMenu.DIVIDER);

      // interface information
      let itfWidth = itf.getSize(); // hypothetical width since not connected
      if(node.category == sk.SPLIT && thisPath != 'base'){
        // likely not the correct one since building branches
        // that have min=2 width by inference
        let baseWidth = node.base.getSize();
        let currWidth = node.branches.reduce((sum, bra) => {
          if(bra.isConnected()){
            return sum + bra.getSize();
          }
          return sum; // do not count as "current"
        }, 0);
        let numEmpty = node.branches.reduce((sum, bra) => {
          return bra.isConnected() ? sum : sum + 1;
        }, 0);
        if(node.folded){
          itfWidth = Math.max(2, Math.round((baseWidth - currWidth) / numEmpty));
        } else {
          let mult = shape.isTwoSided('base') ? 2 : 1;
          itfWidth = Math.max(2, Math.round((baseWidth * mult - currWidth) / numEmpty));
        }
      } else {
        // maybe the exact width
        itfWidth = itf.getSize(); // node.getSize(thisPath);
      }

      // extension node
      const create = (text, type, params) => {
        return {
          text, icon: '<i class="' + type + '"></i>',
          // disabled: type != sk.JOINT && (params.type == sk.CYLINDER) != shape.isTwoSided(thisPath),
          event: () => {
            // load skeleton function only now (else does not exist yet)
            let n = createNode(type, params, true);
            if(type == sk.JOINT){
              // ensure width is at most that of the node interface
              if(itfWidth < n.width)
                n.width = itfWidth;
            } else {
              // using same width
              n.width = itfWidth;
            }
            // use same gauge
            n.gauge = node.gauge;
            // create connection with the new node
            itf.connectTo(n.bottom);
            renderSkeleton(true);
          }
        };
      };
      // extend with new node
      actions.push({
        text: 'Extend with a &hellip;',
        menu: [
          create('Flat Sheet', sk.SHEET, { type: sk.FLAT }),
          create('Tubular Sheet', sk.SHEET, { type: sk.CYLINDER }),
          create('Joint', sk.JOINT)
        ]
      });

      // split function
      const splitInto = (degree, folded, fromBranch) => {
        // create split and connect to this node
        const split = createNode(sk.SPLIT, { degree, folded }, true);
        if(fromBranch)
          split.branches[0].connectTo(itf);
        else
          split.base.connectTo(itf);
        renderSkeleton(true);
      };
      // generate submenu for type of folded split
      const splitTypes = (count, fromBranch) => {
        return [
          { text: 'along the bed', event: () => {
            if(typeof count == 'string'){
              askForNumber('Number of branches',
                5, { integer: true, min: 2 }).then(num => {
                splitInto(num, true, fromBranch);
              }).catch(noop);
            } else
              splitInto(count, true, fromBranch);
          } },
          { text: (count == 2 ? 'across' : 'around') + ' the beds', event: () => {
            if(typeof count == 'string'){
              askForNumber('Number of branches',
                5, { integer: true, min: 2 }).then(num => {
                splitInto(num, false, fromBranch);
              }).catch(noop);
            } else
              splitInto(count, false, fromBranch);
          } }
        ]; // end list (menu)
      };

      // split interface (using new split node)
      let splits;
      actions.push(splits = {
        text: 'Split into &hellip;',
        menu: [2, 3, 4, 5, 'N'].map(count => {
          return {
            text: count + ' &hellip;',
            menu: splitTypes(count, false)
          };
        }) // end map
      }); //end push

      // if interface is flat, then only allow split along bed (not across)
      if(!shape.isTwoSided(thisPath)){
        splits.menu = splits.menu.map(entry => {
          entry.text = entry.text.replace(' &hellip;', '');
          entry.event = entry.menu[0].event;
          delete entry.menu;
          return entry;
        });
      }

      // joint interfaces (merge using new split node)
      actions.push({
        text: 'Join &hellip;',
        menu: [2, 3, 4, 5, 'N'].map(count => {
          return {
            text: count + ' nodes &hellip;',
            menu: splitTypes(count, true)
          };
        }) // end map
      }); // end push
    }

    // general connection to
    let others = [];
    for(let n of env.nodes){
      if(n == node)
        continue;
      for(let otherItf of n.getInterfaces()){
        if(otherItf.isConnected())
          continue;
        let otherPath = otherItf.thisSide(n).path;
        others.push({
          text: '#' + n.id + '/' + otherPath,
          event: () => {
            itf.connectTo(otherItf);
            renderSkeleton(true);
          }
        });
      }
    }
    if(others.length)
      actions.push({ text: 'Connect to', menu: others });
    if(onlyActions) {
      // show node actions
      actions.push(ContextMenu.DIVIDER);
      for(let side of itf.sides){
        if(!side || !side.node)
          continue;
        // provide that side's node and its actions
        const node = side.node;
        actions.push({
          text: 'node <span class="itf">#' + node.id + '/' + side.path + '</span>',
          menu: this.nodeActions(node)
        });
      }
      return actions;
    } else {
      const info = itf.isConnected() ? '#' + otherSide.node.id + '/' + otherSide.path : itf.state;
      return { text: thisPath + '<span class="itf">' + info + '</span>', menu: actions };
    }
  },

  multipleActions(groups){
    if(groups.some(g => !g.first().shape))
      return [ 'No available action' ];

    let menu = [];
    // block pair
    if(groups.length == 2){
      // the two shapes
      let s1 = groups[0].first().shape;
      let s2 = groups[1].first().shape;

      // the two nodes' neighbors
      let nn1 = getNodeNeighbors(s1.node);
      let nn2 = getNodeNeighbors(s2.node);

      // if connected = only allow disconnecting
      if(nn2.includes(s1.node)){
        let itf = s1.node.getInterfaces().filter(itf => {
          let other = itf.otherSide(s1.node);
          return other && other.node == s2.node;
        })[0];
        return [{
          text: 'Disconnect ' + s1.node.id + '/' + itf.thisSide(s1.node).path
            + ' from ' + s2.node.id + '/' + itf.thisSide(s2.node).path,
          event: () => {
            itf.disconnect();
            renderSkeleton(true);
          }
        }];
      }

      // check if both are connected to the same node
      let shared = nn1.find(n => nn2.includes(n));
      if(shared){
        // cannot allow connecting between nodes
        // (because it would create a cycle)
        // but allow swapping the connections
        let [p1s, ps1] = getPathsBetween(s1.node, shared);
        let [p2s, ps2] = getPathsBetween(s2.node, shared);
        let itf1 = s1.node.getInterface(p1s);
        let itf2 = s2.node.getInterface(p2s);
        assert(itf1 && itf1.isConnected()
            && itf2 && itf2.isConnected(), 'Invalid state');
        return [{
          text: 'Swap connections with ' + shared.id + ' - ' + shared.name,
          event: () => {
            // disconnect both interfaces
            itf1.disconnect();
            itf2.disconnect();
            // reconnect swapped interfaces
            s1.node.getInterface(p1s).connectTo(shared.getInterface(ps2));
            s2.node.getInterface(p2s).connectTo(shared.getInterface(ps1));
            // update layout
            renderSkeleton(true);
          }
        }];
      }

      // allow connecting if they both have startable interfaces
      if(s1.getStartInterface() && s2.getStartInterface()){
        let i1 = s1.getStartInterfaces();
        let i2 = s2.getStartInterfaces();

        // order interface pairs by likelihood
        // 1 = needs to match width and sidedness
        // 2 = should use different interface names (e.g. top vs bottom)
        for(let itf1 of i1){
          let p1 = itf1.sides[0].path;
          let w1 = itf1.getSize(); // s1.node.getSize(p1);
          let t1 = s1.isTwoSided(p1);
          for(let itf2 of i2){
            let p2 = itf2.sides[0].path;
            let w2 = itf2.getSize(); // s2.node.getSize(p2);
            let t2 = s2.isTwoSided(p2);
            let text = 'Connect together ' + s1.node.id + '/' + p1 + ' to ' + s2.node.id + '/' + p2;
            let matching = w1 == w2 && t1 == t2;
            if(!matching){
              text += ' (not matching)';
            }
            menu.push({
              text, matching,
              order: (matching ? 0 : 2) + (p1 == p2 ? 1 : 0),
              event: () => {
                itf1.connectTo(itf2);
                renderSkeleton(true);
              }
            });
          } // endfor itf2 of i2
        } // endfor itf1 of i1

        // order according to validity (order value)
        menu.sort((a, b) => a.order - b.order);

        // add divider between matching and non-matching pairs
        let idx = menu.findIndex(({ matching }) => !matching);
        if(idx > 0)
          menu.splice(idx, 0, ContextMenu.DIVIDER);
      } // endif start interfaces
    } // endif groups.length == 2

    if(!menu.length)
      menu.push('Selection (' + groups.length + ')');
    return menu;
  }
};
