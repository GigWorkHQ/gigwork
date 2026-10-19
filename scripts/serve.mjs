import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
let port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be an integer from 1024 to 65535.');
const requestedPort=port;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end('Forbidden');return}let info=await stat(file).catch(()=>null);if(!info?.isFile()){if(path.extname(url.pathname)){res.writeHead(404);res.end('Not found');return}file=path.join(root,'index.html')}const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(body)}catch{res.writeHead(500);res.end('Preview unavailable')}});
server.on('listening',()=>{
 const url=`http://127.0.0.1:${port}`;
 console.log(`Gigwork preview: ${url}\nDashboard: ${url}/app/overview\nMarketplace: ${url}/app/work\nNo dependencies or account are needed for this included build.\nKeep this terminal open. Press Ctrl+C to stop.`);
 if(process.argv.includes('--open')&&process.env.GIGWORK_NO_OPEN!=='1'){
  const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
  const browser=spawn(command,[url],{stdio:'ignore',detached:true,windowsHide:true});
  browser.on('error',()=>console.log(`Open ${url} in your browser.`));browser.unref();
 }
});
server.on('error',error=>{
 if(error.code==='EADDRINUSE'&&!process.env.PORT&&port<requestedPort+10&&port<65535){console.log(`Port ${port} is occupied; trying ${port+1}.`);port++;server.listen(port,'127.0.0.1');return}
 console.error(error.code==='EADDRINUSE'?`Port ${port} is occupied. Set PORT to another number and retry.`:error.message);process.exitCode=1;
});
if(!(await stat(path.join(root,'index.html')).catch(()=>null))?.isFile()){console.error('The included dist build is missing. Run pnpm install --frozen-lockfile, then pnpm build.');process.exitCode=1}else server.listen(port,'127.0.0.1');
