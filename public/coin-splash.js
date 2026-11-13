/* CoinSplash v3 — 3D coin toss + word-by-word title. Raw WebGL, zero dependencies.
   CoinSplash.run({face:'coin-face.png', fallback:'icon-512.png', words:['دارایی','من'], onDone:fn}) */
(function(w){'use strict';
var R=1,T=.6737,H=T/2,B=.03,FOV=14*Math.PI/180,E=.5714,sE=Math.sin(E),cE=Math.cos(E),TH=Math.tan(FOV/2),END=3,DT=1/240,PI=Math.PI;
function mul(a,b){var o=new Float32Array(16),i,j,k,s;for(i=0;i<4;i++)for(j=0;j<4;j++){s=0;for(k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];o[i*4+j]=s}return o}
function rx(t){var c=Math.cos(t),s=Math.sin(t);return[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]}
function ry(t){var c=Math.cos(t),s=Math.sin(t);return[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]}
function rz(t){var c=Math.cos(t),s=Math.sin(t);return[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]}
function tr(x,y,z){return[1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]}
function pj(m,x,y,z){var q=m[3]*x+m[7]*y+m[11]*z+m[15];return[(m[0]*x+m[4]*y+m[8]*z+m[12])/q,(m[1]*x+m[5]*y+m[9]*z+m[13])/q]}
function camera(a){var d=Math.max(4/TH,1.95/(a*TH)),f=1/TH,n=1,fa=160,
 P=[f/a,0,0,0,0,f,0,0,0,0,(fa+n)/(n-fa),-1,0,0,2*fa*n/(n-fa),0],V=[1,0,0,0,0,cE,sE,0,0,-sE,cE,0,0,0,-d,1];
 return{d:d,vp:mul(P,V),eye:[0,d*sE,d*cE]}}
function mesh(){var N=72,V=[],I=[],s0=[[0,H,0,1,0,0],[R-B,H,0,1,0,0]],s1=[],s3=[],
 s2=[[R,H-B,1,0,2,0],[R,-H+B,1,0,2,1]],s4=[[R-B,-H,0,-1,0,0],[0,-H,0,-1,0,0]];
 for(var i=0;i<=4;i++){var a=i/4*PI/2,sa=Math.sin(a),ca=Math.cos(a);
  s1.push([R-B+B*sa,H-B+B*ca,sa,ca,1,0]);s3.push([R-B+B*ca,-H+B-B*sa,ca,-sa,1,0])}
 [s0,s1,s2,s3,s4].forEach(function(s){var base=V.length/9,i,j;
  s.forEach(function(q){for(var j=0;j<=N;j++){var f=j/N*2*PI,c=Math.cos(f),sn=Math.sin(f),x=q[0]*c,z=q[0]*sn;
   V.push(x,q[1],z,q[2]*c,q[3],q[2]*sn,q[4]==2?j/N:x/R*.5+.5,q[4]==2?q[5]:z/R*.5+.5,q[4])}});
  for(i=0;i<s.length-1;i++)for(j=0;j<N;j++){var a=base+i*(N+1)+j,b=a+N+1;I.push(a,b,a+1,a+1,b,b+1)}});
 return{v:new Float32Array(V),i:new Uint16Array(I)}}
/* Motion: eased (non-gravity) rise with long hang-time, heavy fast drop; spin speed is tied to
   vertical speed (fast on throw, almost stops at the apex so the logo faces camera, whips on the way down). */
var TU=.78,TD=.5,Tc=TU+TD,Y0=.55,YA=3.45,YC=.85,PU=2.5,PD=2.3,VM=(YA-YC)*PD/TD,AA=4*PI+1,TT=6*PI;
function fl(t){var s;if(t<TU){s=1-t/TU;return[Y0+(YA-Y0)*(1-Math.pow(s,PU)),(YA-Y0)*PU*Math.pow(s,PU-1)/TU]}
 s=Math.min(1,(t-TU)/TD);return[YA-(YA-YC)*Math.pow(s,PD),-(YA-YC)*PD*Math.pow(s,PD-1)/TD]}
function fs(q){return .06+.94*Math.pow(Math.min(1,Math.abs(q)/VM),1.6)}
function sim(zs){var IU=0,ID=0,t,i;
 for(t=0;t<Tc;t+=DT){var q=fl(t)[1];if(t<TU)IU+=fs(q)*DT;else ID+=fs(q)*DT}
 var wU=AA/IU,wD=(TT+.6-AA)/ID,n=Math.ceil(END/DT),o=new Float32Array(n*6),y=Y0,z=zs,vy=0,th=0,wv=0,tl=-1,sq=-.6;
 for(i=0;i<n;i++){t=i*DT;
  if(t<Tc){var r=fl(t);y=r[0];vy=r[1];th+=(t<TU?wU:wD)*fs(vy)*DT;z=zs*Math.pow(1-t/Tc,1.6)}
  else{if(tl<0){tl=t;vy=VM*.26;wv=wD*.3;sq=1}
   wv+=(-300*(th-TT)-14*wv)*DT;th+=wv*DT;vy-=17*DT;y+=vy*DT;z-=z*8*DT;
   var hh=R*Math.abs(Math.sin(th))+H*Math.abs(Math.cos(th));
   if(y<hh){y=hh;if(vy<0){sq=Math.min(1,sq+Math.min(1,-vy/9));vy=-vy*.3;if(Math.abs(vy)<.7)vy=0}}}
  sq*=1-14*DT;
  o[i*6]=y;o[i*6+1]=z;o[i*6+2]=th;o[i*6+3]=(.1+(tl<0?.05*Math.sin(t*9):0))*(tl<0?1:Math.exp(-9*(t-tl)));
  o[i*6+4]=.5*Math.pow(Math.max(0,1-(tl<0?t/Tc:1)),2);o[i*6+5]=sq}
 return{d:o,n:n}}
var PH='#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
var VC='attribute vec3 p,n;attribute vec2 t;attribute float k;uniform mat4 uM,uV;uniform mat3 uN;varying vec3 vN,vW;varying vec2 vT;varying float vK;void main(){vec4 w=uM*vec4(p,1.);vW=w.xyz;vN=uN*n;vT=t;vK=k;gl_Position=uV*w;}';
var FC=PH+'uniform sampler2D uF,uS;uniform vec3 uE,uInk;uniform float uG,uSw;varying vec3 vN,vW;varying vec2 vT;varying float vK;void main(){vec3 c;float id=.5;if(uG<.5){if(vK<.5){c=texture2D(uF,vT).rgb;id=1.;}else if(vK<1.5)c=vec3(.91);else c=texture2D(uS,vT).rgb;}else{vec3 N=normalize(vN),V=normalize(uE-vW),L=normalize(vec3(-.4,.9,.5));float nh=max(dot(N,normalize(L+V)),0.),df=max(dot(N,L),0.),sp=pow(nh,70.)*.8+pow(nh,9.)*.2;if(vK<.5){float t=clamp((texture2D(uF,vT).r-.11)/.86,0.,1.);vec2 q=vT-.5;vec3 g=mix(vec3(.88,.56,.07),vec3(1.,.86,.3),clamp(.55+.5*(-q.x*.6-q.y*.8)+.25*df,0.,1.));float sw=1.-smoothstep(0.,.09,abs(vT.x*.8-vT.y*.6+.3-uSw));c=mix(uInk,g+sp*vec3(1.,.93,.65)+sw*.5*vec3(1.,.95,.7),t);id=1.;}else{float v=vK<1.5?.4:vT.y;c=mix(vec3(1.,.82,.24),vec3(.76,.47,.06),v)*(.78+.4*df)+sp*vec3(1.,.9,.6)*.8;}}gl_FragColor=vec4(c,id);}';
var VQ='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
var FQ='precision mediump float;uniform sampler2D uT;uniform vec2 uPx;uniform float uRho;uniform vec3 uInk;void main(){vec2 uv=gl_FragCoord.xy*uPx;vec4 c=texture2D(uT,uv);float cov=step(.2,texture2D(uT,uv+vec2(.75,.75)*uPx).a)+step(.2,texture2D(uT,uv+vec2(-.75,.75)*uPx).a)+step(.2,texture2D(uT,uv+vec2(.75,-.75)*uPx).a)+step(.2,texture2D(uT,uv+vec2(-.75,-.75)*uPx).a);cov*=.25;if(cov<.01)discard;bool blk=c.a<.2;if(!blk){for(int r=0;r<3;r++){float rr=uRho*(.34+.33*float(r));vec2 d=vec2(1.,0.);for(int i=0;i<14;i++){float n=texture2D(uT,uv+d*rr*uPx).a;if(n<.2||(c.a>.75&&n<.75)){blk=true;break;}d=vec2(d.x*.901-d.y*.4339,d.x*.4339+d.y*.901);}if(blk)break;}}gl_FragColor=vec4(blk?uInk:c.rgb,cov);}';
var VG='attribute vec3 p;uniform mat4 uV;varying vec3 vW;void main(){vW=p;gl_Position=uV*vec4(p,1.);}';
var FG=PH+'uniform vec2 uC,uX,uP;varying vec3 vW;void main(){float d=length((vW.xz-uC)/uX);gl_FragColor=vec4(0.,0.,0.,uP.x*(1.-smoothstep(1.-uP.y,1.+uP.y,d)));}';
function prog(gl,v,f){var p=gl.createProgram();[[gl.VERTEX_SHADER,v],[gl.FRAGMENT_SHADER,f]].forEach(function(s){var h=gl.createShader(s[0]);gl.shaderSource(h,s[1]);gl.compileShader(h);if(!gl.getShaderParameter(h,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(h));gl.attachShader(p,h)});gl.linkProgram(p);return p}
function tex(gl,src){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);gl.generateMipmap(gl.TEXTURE_2D);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 var an=gl.getExtension('EXT_texture_filter_anisotropic');if(an)gl.texParameterf(gl.TEXTURE_2D,an.TEXTURE_MAX_ANISOTROPY_EXT,4);return t}
function sideCanvas(){var c=document.createElement('canvas');c.width=64;c.height=128;var x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,128);
 g.addColorStop(0,'#eaeaea');g.addColorStop(1,'#e0e0e0');x.fillStyle=g;x.fillRect(0,0,64,128);return c}
function run(o){o=o||{};var SP=o.speed||1.25;var isDark=false;try{isDark=document.documentElement.dataset.theme==='dark';}catch(e){}var clearRgb=isDark?[0.0431,0.0510,0.0667]:[1,1,1];var bgHex=isDark?'#0b0d11':'#fff';var gold=o.theme==='gold',ink=gold?[.15,.1,.04]:[.11,.137,.165],inkC=isDark?'#f4f6fa':(gold?'#261a08':'#1c232a');var ov=document.getElementById('coin-splash'),fin=false,raf=0,gl=null,cv,txt,spans=[],shown=0;
 if(!ov){ov=document.createElement('div');ov.id='coin-splash';document.body.appendChild(ov)}
 ov.style.cssText='position:fixed;inset:0;z-index:99999;background:'+bgHex+';touch-action:manipulation;opacity:1;overflow:hidden';
 function done(){if(fin)return;fin=true;cancelAnimationFrame(raf);o.onDone&&o.onDone();ov.style.transition='opacity '+(.5/SP)+'s ease';ov.style.opacity='0';
  setTimeout(function(){ov.remove();var l=gl&&gl.getExtension('WEBGL_lose_context');l&&l.loseContext()},Math.round(560/SP))}
 function still(){var i=new Image();i.onload=i.onerror=function(){ov.innerHTML='';i.style.cssText='position:absolute;left:50%;top:50%;width:min(56vmin,300px);transform:translate(-50%,-50%)';ov.appendChild(i);setTimeout(done,900)};i.src=o.fallback||o.face}
 var reduced=w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches;
 try{cv=document.createElement('canvas');cv.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block';
  gl=cv.getContext('webgl',{antialias:false,alpha:false,powerPreference:'low-power'});if(!gl)throw 0;ov.appendChild(cv)}catch(e){return still()}
 ov.addEventListener('click',done);
 /* title: each word is its own element so it can be revealed one by one */
 txt=document.createElement('div');txt.style.cssText='position:absolute;left:0;right:0;text-align:center;direction:rtl;color:'+inkC+';font-family:Vazirmatn,Vazir,Tahoma,system-ui,sans-serif;font-weight:900;-webkit-text-stroke:.025em '+inkC+';line-height:1.5;white-space:nowrap;pointer-events:none';
 (o.words||['دارایی','من']).forEach(function(t){var m=document.createElement('span'),e=document.createElement('span');m.style.cssText='display:inline-block;overflow:hidden;vertical-align:top;padding:.25em .08em;margin:-.25em .12em';e.textContent=t;e.style.cssText='display:inline-block;transform:translateY(150%);will-change:transform';m.appendChild(e);txt.appendChild(m);spans.push(e)});ov.appendChild(txt);
 function show(e){e.style.transition='transform '+(.8/SP)+'s cubic-bezier(.16,1,.3,1)';e.style.transform='none'}
 var img=new Image(),imgP=new Promise(function(r,j){img.onload=r;img.onerror=j});img.src=o.face;
 var fontP=Promise.race([w.document.fonts&&document.fonts.load?document.fonts.load('900 32px Vazirmatn'):0,new Promise(function(r){setTimeout(r,700)})]).catch(function(){});
 Promise.all([imgP,fontP]).then(function(){try{start(img)}catch(e){gl=null;still()}},still);
 function start(img){
  var pc=prog(gl,VC,FC),pg=prog(gl,VG,FG),m=mesh(),vb=gl.createBuffer(),ib=gl.createBuffer(),gb=gl.createBuffer(),tF=tex(gl,img),tS=tex(gl,sideCanvas()),pq=prog(gl,VQ,FQ),fb=gl.createFramebuffer(),ft=gl.createTexture(),rb=gl.createRenderbuffer(),qb=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  function fbo(W,H){gl.bindTexture(gl.TEXTURE_2D,ft);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,null);[[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]].forEach(function(q){gl.texParameteri(gl.TEXTURE_2D,q[0],q[1])});gl.bindRenderbuffer(gl.RENDERBUFFER,rb);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,W,H);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,ft,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,rb);gl.bindFramebuffer(gl.FRAMEBUFFER,null)}
  gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,m.v,gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.i,gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,gb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-40,0,-40,40,0,-40,-40,0,40,40,0,40]),gl.STATIC_DRAW);
  var cam,S,oy=0,zs=0;
  function layout(){var dpr=Math.min(w.devicePixelRatio||1,2),W=ov.clientWidth||innerWidth,Hh=ov.clientHeight||innerHeight;cv.width=Math.round(W*dpr);cv.height=Math.round(Hh*dpr);gl.viewport(0,0,cv.width,cv.height);fbo(cv.width,cv.height);
   var c=camera(W/Hh),l=pj(c.vp,-1,H,0),r=pj(c.vp,1,H,0),wp=(r[0]-l[0])/2*W,fz=Math.max(16,Math.min(40,wp*.17)),gap=fz*1.1,dx=(o.dx==null?fz*.18:o.dx);
   oy=0;c.vp=mul(tr(0,oy,0),c.vp);cam=c;var b=pj(c.vp,0,0,1);
   txt.style.fontSize=fz+'px';txt.style.left=dx+'px';txt.style.right=(-dx)+'px';txt.style.top='auto';txt.style.bottom='calc(env(safe-area-inset-bottom,0px) + '+Math.round(o.bottom==null?Math.max(36,Hh*.09):o.bottom)+'px)'}
  layout();w.addEventListener('resize',layout);
  var hw=cam.d*TH;for(zs=0;zs<80;zs+=.1){var yv=cE*Y0-sE*zs,dd=cam.d-sE*Y0-cE*zs;if(yv/(TH*dd)+oy<-1-1.2/hw)break}
  S=sim(zs);
  var U=function(p,n){return gl.getUniformLocation(p,n)},A=function(p,n){return gl.getAttribLocation(p,n)};
  gl.clearColor(clearRgb[0],clearRgb[1],clearRgb[2],1);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  function draw(t){var f=Math.min(t/DT,S.n-1.001),i=f|0,u=f-i,a=i*6,b=a+6,d=S.d,L=function(k){return d[a+k]+(d[b+k]-d[a+k])*u};
   var y=L(0),z=L(1),th=L(2),roll=L(3),yaw=L(4),sq=L(5),Rm=mul(ry(yaw),mul(rz(roll),rx(th))),hy=R*Math.abs(Math.sin(th))+H*Math.abs(Math.cos(th)),
    M=mul(tr(0,y-.1*sq*hy,z),mul([1+.05*sq,0,0,0,0,1-.1*sq,0,0,0,0,1+.05*sq,0,0,0,0,1],Rm)),
    h=Math.max(0,y-hy),ez=Math.max(.3,R*Math.abs(Math.cos(th))+H*Math.abs(Math.sin(th))),vp=mul(tr(0,-.03*Math.max(0,sq),0),cam.vp);
   var Wd=cv.width,Hd=cv.height,pa=pj(vp,1,y,z),pb=pj(vp,-1,y,z),p0=pj(vp,0,y,z),rpx=(pa[0]-pb[0])*Wd/4;
   gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.disable(gl.BLEND);gl.clearColor(clearRgb[0],clearRgb[1],clearRgb[2],0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   gl.useProgram(pc);gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);
   [['p',3,0],['n',3,3],['t',2,6],['k',1,8]].forEach(function(q){var l=A(pc,q[0]);gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,q[1],gl.FLOAT,false,36,q[2]*4)});
   gl.uniformMatrix4fv(U(pc,'uM'),false,M);gl.uniformMatrix4fv(U(pc,'uV'),false,vp);
   gl.uniformMatrix3fv(U(pc,'uN'),false,[Rm[0],Rm[1],Rm[2],Rm[4],Rm[5],Rm[6],Rm[8],Rm[9],Rm[10]]);gl.uniform3fv(U(pc,'uE'),cam.eye);gl.uniform1f(U(pc,'uG'),gold?1:0);gl.uniform1f(U(pc,'uSw'),t>Tc?-.4+(t-Tc-.1)*1.5:-1);gl.uniform3fv(U(pc,'uInk'),ink);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tF);gl.uniform1i(U(pc,'uF'),0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tS);gl.uniform1i(U(pc,'uS'),1);
   gl.drawElements(gl.TRIANGLES,m.i.length,gl.UNSIGNED_SHORT,0);
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(clearRgb[0],clearRgb[1],clearRgb[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.BLEND);
   gl.useProgram(pg);gl.depthMask(false);gl.bindBuffer(gl.ARRAY_BUFFER,gb);var ap=A(pg,'p');gl.enableVertexAttribArray(ap);gl.vertexAttribPointer(ap,3,gl.FLOAT,false,0,0);
   gl.uniformMatrix4fv(U(pg,'uV'),false,vp);gl.uniform2f(U(pg,'uC'),.3*h,z-.35*h);gl.uniform2f(U(pg,'uX'),R*(1+.25*h),ez*(1+.25*h));
   gl.uniform2f(U(pg,'uP'),.34/(1+.7*h),Math.min(.55,.22+.1*h));gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.depthMask(true);
   /* uniform-width screen-space outline: black where an empty pixel is within rho (silhouette) or, on faces, where the side is within rho (crease) */
   gl.disable(gl.DEPTH_TEST);gl.useProgram(pq);gl.bindBuffer(gl.ARRAY_BUFFER,qb);var aq=A(pq,'p');gl.enableVertexAttribArray(aq);gl.vertexAttribPointer(aq,2,gl.FLOAT,false,0,0);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,ft);gl.uniform1i(U(pq,'uT'),0);gl.uniform2f(U(pq,'uPx'),1/Wd,1/Hd);gl.uniform1f(U(pq,'uRho'),.17*rpx);gl.uniform3fv(U(pq,'uInk'),ink);
   var hf=rpx*1.15+4;gl.enable(gl.SCISSOR_TEST);gl.scissor(Math.floor((p0[0]*.5+.5)*Wd-hf),Math.floor((p0[1]*.5+.5)*Hd-hf),Math.ceil(2*hf),Math.ceil(2*hf));
   gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disable(gl.SCISSOR_TEST);gl.enable(gl.DEPTH_TEST)}
  if(reduced){draw(END);spans.forEach(function(e){e.style.transform='none'});setTimeout(done,900);return}var t0=performance.now(),at=[TU+.15,TU+.4];
  (function loop(now){if(fin)return;var el=(now-t0)/1000*SP;draw(Math.min(el,END));
   while(shown<spans.length&&el>=at[shown])show(spans[shown++]);
   if(el>END+.6)return done();raf=requestAnimationFrame(loop)})(t0)}
 cv.addEventListener('webglcontextlost',function(e){e.preventDefault();still()})}
w.CoinSplash={run:run}})(window);
