'use strict';
let controls;
module.exports=(req,res,next)=>controls?controls.middleware(req,res,next):next();
module.exports.setControls=value=>{controls=value;};
