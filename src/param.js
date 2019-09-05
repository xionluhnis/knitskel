// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const DSL = require('./dsl.js');
const Function1D = require('./fun1d.js');
const Layout = require('./layout.js');
const UserPattern = require('./userpattern.js');

// type constants
const p = {
  STRING  : 0,
  NUMBER  : 1,
  BOOLEAN : 2,
  FUN1D   : 3,
  LAYOUT  : 4,
  ARRAY   : 5,
  PATTERN : 6
};
const validTypes = Object.values(p);
const typeNames = {
  [p.STRING]: 'string',
  [p.NUMBER]: 'number',
  [p.BOOLEAN]: 'boolean',
  [p.FUN1D]: 'fun1d',
  [p.LAYOUT]: 'layout',
  [p.ARRAY]: 'array',
  [p.PATTERN]: 'pattern'
};
const keywords = [ 'auto' ];

// storage for user parameters
let userParams = {
  list: [], map: {}
};

/**
 * Create a parameter
 *
 * @param ctx the parameter context (e.g. node, parent)
 * @param name the parameter identifier
 * @param type the expected value type
 * @param value the current value
 */
function Parameter(ctx, name, type, value){
  this.context = ctx || null;
  this.name = name;
  this.type = type || p.STRING;
  assert(validTypes.includes(this.type), 'Invalid type', type);
  this.expr = false;
  this.references = new Set();
  this.constraints = {};
  // set value
  if(value !== undefined)
    this.update(value);
  else
    this.reset();
}
for(let type in typeNames){
  Parameter[typeNames[type]] = function(ctx, name, value){
    return new Parameter(ctx, name, type, value);
  };
}

/**
 * Set default type value
 */
Parameter.prototype.reset = function(){
  switch(this.type){
    case p.STRING:  this.value = '1'; break;
    case p.NUMBER:  this.value = 1; break;
    case p.BOOLEAN: this.value = true; break;
    case p.FUN1D:   this.value = Function1D.from(1); break;
    case p.LAYOUT:  this.value = new Layout(this.context); break;
    case p.ARRAY:   this.value = []; break;
    case p.PATTERN: this.value = new UserPattern(); break;
    default: throw 'Unsupported parameter type: ' + this.type;
  }
  this.expr = false;
};

/**
 * Add a parameter constraint
 *
 * @param type constraint type
 * @param value constraint value
 */
Parameter.prototype.constraint = function(type, value){
  this.constraints[type] = value; // this.constraints.push(spec);
  return this;
};

/**
 * Returns a list of user parameters within an expression
 *
 * @param expr the string expression
 * @return a list of user parameters being used
 */
function userParamsOf(expr){
  let userRx = RegExp('[#\$]([A-Za-z_]+)', 'g');
  let list = expr.match(userRx) || [];
  return list.map(str => str.substr(1));
}

/**
 * Returns a list of potential node parameters within an expression
 *
 * @param expr the string expression
 * @return a list of potential node parameters being used (some may be invalid)
 */
function nodeParamsOf(expr){
  let userRx = RegExp('@([A-Za-z_]+)', 'g');
  let list = expr.match(userRx) || [];
  return list.map(str => str.substr(1));
}

/**
 * Replace the user parameters of an expression with their value
 *
 * @param param the parameter context
 * @param expr the expression string
 * @param create whether to create unknown user parameters
 * @return the expression after replacing all user parameters or null if a cycle was found
 */
function evalUserExpr(param, expr, create){
  // recursively replace user parameters in an expression
  let userRx = RegExp('[#\$]([A-Za-z_]+)'); // recursive loop => no 'g' parameter
  let m;
  let next = () => {
    m = userRx.exec(expr);
    return m;
  };
  let it = 0;
  while(next()){
    // abort evaluation if too long (cyclic user parameters)
    if(++it > 100)
      return null;
    // m = [fullStr, name, index: idx, input: str]
    let uName = m[1];
    let uVal;
    
    // create user parameter if necessary
    if(create){
      let up;
      if(uName in userParams.map)
        up = userParams.map[uName];
      else {
        // create user parameter
        up = new Parameter(null, uName);
        userParams.map[uName] = up;
        userParams.list.push(up);
      }
      // add reference
      up.references.add(param);
    }
    
    // get value
    if(uName in userParams.map)
      uVal = userParams.map[uName].eval();
    else
      uVal = '1'; // default value
    
    // develop string (using parenthesis to ensure priority)
    expr = expr.substr(0, m.index) + '(' + uVal + ')' + expr.substr(m.index + m[0].length);
  }
  return expr;
}

/**
 * Replace node expression by their javascript equivalent using `this`
 *
 * @param param the parameter with a node context
 * @param expr the string expression
 * @return the new string expression with @x replaced with node.x
 */
function evalNodeExpr(param, expr){
  // only evaluate node stuff if there is a context
  if(!param.context)
    return expr;
  // find all valid node expressions
  let nodeRx = RegExp('@([A-Z_a-z]+)', 'g'); // to iterate on all with exec
  let m;
  let next = () => {
    m = nodeRx.exec(expr);
    return m;
  };
  while(next()){
    let name = m[1];
    if(name in param.context){
      expr = expr.substr(0, m.index) + 'this.' + expr.substr(m.index + 1);
    }
  }
  return expr;
}

/**
 * Evaluate an expression and cast it into the correct type.
 *
 * Expressions of type STRING only get transformed and are not evaluated.
 *
 * @param param the parameter context
 * @param expr the string expression
 * @param create whether to create new user parameters
 * @return the expression after evaluation
 */
function evalExpr(param, expr, create){
  // assert(param.type != p.STRING, 'Cannot evaluate expression for a string parameter');
  // evaluate user parameters
  if(expr.length){
    expr = evalUserExpr(param, expr, create);
    if(!expr || !expr.length)
      return expr;
  }

  // evaluate node parametersr
  expr = evalNodeExpr(param, expr);

  // as-is for strings
  if(param.type == p.STRING)
    return expr;

  // normalize start / end
  expr.replace(/(^\s+|\s+$)/g, '');

  // enclose with [ ] if needed
  if(param.type == p.LAYOUT || param.type == p.FUN1D || param.type == p.ARRAY){
    if(expr.indexOf('[') == -1)
      expr = '[' + expr;
    if(expr.indexOf(']') == -1)
      expr = expr + ']';
  }

  // evaluation expression
  let value = DSL.expr(expr, { [DSL.This]: param.context });

  // encapsulte for type
  switch(param.type){
    case p.FUN1D:
      return Function1D.from(value);
    case p.LAYOUT:
      return Layout.from(value);
  }
  return value;
}

Parameter.prototype.extractUserParameters = function(){
  if(!this.expr || !this.value.length)
    return [];
  return userParamsOf(this.value);
};

Parameter.prototype.extractNodeParameters = function(){
  if(!this.expr || !this.value.length)
    return [];
  return nodeParamsOf(this.value);
};

/**
 * Update the parameter's value
 *
 * This potentially allocates new user parameters in case
 * the new value is an expression with novel undefined user parameters.
 *
 * @param value the new value
 */
Parameter.prototype.update = function(value, throwing){
  const isString = typeof value == 'string';
  const hasParam = isString && (userParamsOf(value).length || nodeParamsOf(value).length);
  if(isString && this.type != p.PATTERN && !keywords.includes(value)
     && (this.type != p.STRING || hasParam)){
    try {
      // attempt evaluation to add user parameters
      evalExpr(this, value, true);
    } catch(e){
      if(throwing)
        throw e;
    }
    // is an expression
    this.expr = true;
    this.value = value;
  } else {
    if(this.expr){
      // delete previous user parameter references
      for(let uName of userParamsOf(this.value)){
        let up = Parameter.getUserParameter(uName);
        if(up)
          up.references.delete(this);
      }
    }
    this.expr = false;
  // update value
    if(this.type == p.LAYOUT)
      this.value = Layout.from(this.context, value);
    else if(this.type == p.FUN1D)
      this.value = Function1D.from(value);
    else if(this.type == p.PATTERN)
      this.value = UserPattern.from(value);
    else
      this.value = value;
  }
};

/**
 * Evaluate the parameter's value
 *
 * @return the value after evaluating any expression if valid
 * @throws an exception if an expression is not valid
 */
Parameter.prototype.eval = function(){
  if(this.expr)
    return evalExpr(this, this.value, false); // do not create (should already have been processed during "update" call)
  else
    return this.value;
};

/**
 * Evaluate value without throwing
 *
 * @return the value or null if invalid
 */
Parameter.prototype.safeEval = function(){
  let val = null;
  try {
    val = this.eval();
  } catch (err){
  }
  return val;
};

/**
 * Check whether the current parameter has a valid expression
 *
 * @return whether the parameter has a valid value
 */
Parameter.prototype.isValid = function(){
  // check evaluation
  let value;
  try {
    value = this.eval();
  } catch(e){
    return false;
  }
  // check constraints
  let valid = true;
  if('min' in this.constraints)
    valid &= value >= this.constraints.at_least;
  if('max' in this.constraints)
    valid &= value <= this.constraints.at_most;
  if('integer' in this.constraints)
    valid &= parseFloat(value + '') === parseInt(value + '');
  if('within' in this.constraints)
    valid &= this.constraints.within.includes(value);
  if('is_array' in this.constraints)
    valid &= Array.isArray(value);
  if('length' in this.constraints)
    valid &= value.length == this.constraints.length;

  // only valid if all constraints are satisfied
  return valid;
};

/**
 * Transform the parameter into JSON format
 *
 * @return a serialized version of this parameter
 */
Parameter.prototype.toJSON = function(){
  if(this.expr)
    return this.value;
  switch(this.type){
    case p.FUN1D:   return this.value.toJSON();
    case p.LAYOUT:  return this.value.toJSON();
    case p.PATTERN: return this.value.toJSON();
  }
  return this.value;
};

/**
 * Returns the current list of user parameters
 *
 * @return a list of user parameters
 */
Parameter.getUserParameters = function(){
  return userParams.list.slice();
};

/**
 * Returns the user parameter matching a name
 *
 * @param name a parameter name
 * @return the corresponding user parameter if it exists, else undefined
 */
Parameter.getUserParameter = function(name, create){
  if(create){
    if(!(name in userParams.map)){
      let param = new Parameter(null, name);
      userParams.map[name] = param;
      userParams.list.push(param);
    }
  }
  return userParams.map[name];
};

/**
 * Clear the user parameters
 */
Parameter.clearUserParameters = function(){
  userParams.list = [];
  userParams.map = {};
};

/**
 * Remove a user parameter.
 * This operation fails (returns false) if
 * - the user parameter does not exist
 * - the user parameter has references
 *
 * @param name the parameter name
 * @return whether the operation succeeded
 */
Parameter.removeUserParameter = function(name){
  let param = userParams.map[name];
  if(!param)
    return false;
  if(param.references.size)
    return false;
  delete userParams.map[name];
  userParams.list = userParams.list.filter(p => p != param);
  return true;
};

module.exports = Object.assign(Parameter, p);
