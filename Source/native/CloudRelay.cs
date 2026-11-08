using System;
using System.IO;
using System.Net;
using System.Text;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Threading.Tasks;
static class CloudRelay {
 const string Origin="https://immortalblossombeta.eddiechanxule.workers.dev";
 static readonly CookieContainer Cookies=new CookieContainer();
 static readonly string CookieFile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LuoXian","CloudSession.bin");
 static CloudRelay(){try{var cookie=Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(CookieFile),null,DataProtectionScope.CurrentUser));Cookies.SetCookies(new Uri(Origin),cookie);}catch{}}
 public static Task<object> Request(Dictionary<string,object> p){return Task.Run<object>(()=>{
  var path=Convert.ToString(p["path"]);Uri target;
  if(!Uri.TryCreate(Origin+path,UriKind.Absolute,out target)||target.GetLeftPart(UriPartial.Authority)!=Origin||!target.AbsolutePath.StartsWith("/api/ai/cloud/"))throw new IOException("Invalid cloud route");
  var request=(HttpWebRequest)WebRequest.Create(target);request.CookieContainer=Cookies;request.AllowAutoRedirect=false;request.Timeout=95000;request.Method=p.ContainsKey("body")&&p["body"]!=null?"POST":"GET";
  if(request.Method=="POST"){request.ContentType="application/json";var data=Encoding.UTF8.GetBytes(Convert.ToString(p["body"]));request.ContentLength=data.Length;using(var stream=request.GetRequestStream())stream.Write(data,0,data.Length);}
  HttpWebResponse response;try{response=(HttpWebResponse)request.GetResponse();}catch(WebException e){response=e.Response as HttpWebResponse;if(response==null)throw;}
  using(response){string body;using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))body=reader.ReadToEnd();
   var cookie=Cookies.GetCookieHeader(new Uri(Origin));if(cookie.Length>0){Directory.CreateDirectory(Path.GetDirectoryName(CookieFile));File.WriteAllBytes(CookieFile,ProtectedData.Protect(Encoding.UTF8.GetBytes(cookie),null,DataProtectionScope.CurrentUser));}
   return new {status=(int)response.StatusCode,body=body};}
 });}
}
