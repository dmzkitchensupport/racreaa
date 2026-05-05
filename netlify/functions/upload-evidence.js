// v2 deploy 1778010096
const impl = require('./upload-evidence_impl');
const ALLOWED_ORIGINS = ['https://dmzkitchensupport.github.io','https://mariozumaran.github.io','https://dmz-audit.netlify.app'];
exports.handler = async (event) => {
  const origin = event.headers['origin']||event.headers['Origin']||'';
  const ao = ALLOWED_ORIGINS.includes(origin)?origin:ALLOWED_ORIGINS[0];
  if (event.httpMethod==='OPTIONS') return {statusCode:204,headers:{'Access-Control-Allow-Origin':ao,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Credentials':'true'},body:''};
  const req={method:event.httpMethod,headers:event.headers||{},body:JSON.parse(event.body||'{}'),query:event.queryStringParameters||{},socket:{remoteAddress:''}};
  let sc=200,rb='';
  const rh={'Content-Type':'application/json','Access-Control-Allow-Origin':ao,'Access-Control-Allow-Credentials':'true','Vary':'Origin'};
  const res={setHeader:(k,v)=>{rh[k]=v;},status:(c)=>{sc=c;return res;},json:(d)=>{rb=JSON.stringify(d);return res;},end:(b)=>{if(b)rb=b;return res;}};
  await impl(req,res);
  return {statusCode:sc,headers:rh,body:rb};
};
