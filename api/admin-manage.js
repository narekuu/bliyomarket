const SUPABASE_URL = "https://wgeqrtlqdhnlzedgnrmm.supabase.co";
const SUPABASE_KEY = "sb_publishable_tT3y2YtcCaB49bQKrYq92A_fdPlJPNQ";
const OWNER_UID = "b0a2f77e-ef24-4b84-9c11-58626166184d";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Authorization");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(503).json({ ok:false, error:"Admin API belum dikonfigurasi di server." });
  const auth = req.headers.authorization || "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!accessToken) return res.status(401).json({ ok:false, error:"Login diperlukan." });

  const adminHeaders = { apikey:serviceKey, Authorization:"Bearer " + serviceKey, "Content-Type":"application/json" };
  const userHeaders = { apikey:SUPABASE_KEY, Authorization:"Bearer " + accessToken };
  const send = async (url, options={}) => {
    const response = await fetch(url, options);
    const body = await response.text();
    let data = null;
    try { data = body ? JSON.parse(body) : null; } catch {}
    if (!response.ok) throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || "Permintaan server gagal (" + response.status + ").");
    return data;
  };

  try {
    const caller = await send(SUPABASE_URL + "/auth/v1/user", { headers:userHeaders });
    if (!caller || !caller.id) return res.status(401).json({ok:false,error:"Sesi tidak valid."});
    const owner = caller.id === OWNER_UID;
    const action = req.method === "GET" ? String(req.query.action || "status") : String((req.body || {}).action || "");

    if (action === "status") {
      if (owner) return res.status(200).json({ok:true,isAdmin:true,isOwner:true});
      const rows = await send(SUPABASE_URL + "/rest/v1/bliyo_admins?select=user_id&user_id=eq." + encodeURIComponent(caller.id) + "&limit=1", {headers:adminHeaders});
      return res.status(200).json({ok:true,isAdmin:Array.isArray(rows) && rows.length > 0,isOwner:false});
    }

    if (!owner) return res.status(403).json({ok:false,error:"Hanya Owner yang boleh mengelola admin."});

    if (action === "search") {
      const email = String((req.body || {}).email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ok:false,error:"Masukkan email yang valid."});
      let found = null;
      for (let page=1; page<=10 && !found; page++) {
        const result = await send(SUPABASE_URL + "/auth/v1/admin/users?page=" + page + "&per_page=1000", {headers:adminHeaders});
        const users = Array.isArray(result?.users) ? result.users : [];
        found = users.find(u => String(u.email || "").trim().toLowerCase() === email) || null;
        if (users.length < 1000) break;
      }
      if (!found) return res.status(404).json({ok:false,error:"Akun dengan email tersebut belum terdaftar."});
      const profileRows = await send(SUPABASE_URL + "/rest/v1/user_profiles?select=name,email&id=eq." + encodeURIComponent(found.id) + "&limit=1", {headers:adminHeaders});
      const members = await send(SUPABASE_URL + "/rest/v1/bliyo_admins?select=user_id&user_id=eq." + encodeURIComponent(found.id) + "&limit=1", {headers:adminHeaders});
      return res.status(200).json({ok:true,user:{id:found.id,email:found.email,name:profileRows?.[0]?.name || found.user_metadata?.name || "Pengguna",isAdmin:found.id===OWNER_UID || (Array.isArray(members)&&members.length>0),isOwner:found.id===OWNER_UID}});
    }

    if (action === "list") {
      const rows = await send(SUPABASE_URL + "/rest/v1/bliyo_admins?select=user_id,email,created_at&order=created_at.desc", {headers:adminHeaders});
      return res.status(200).json({ok:true,admins:rows || []});
    }

    if (action === "add" || action === "remove") {
      const id = String((req.body || {}).user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ok:false,error:"ID pengguna tidak valid."});
      if (id === OWNER_UID) return res.status(403).json({ok:false,error:"Owner utama tidak dapat diubah."});
      if (action === "add") {
        const target = await send(SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(id), {headers:adminHeaders});
        if (!target?.id || !target?.email) return res.status(404).json({ok:false,error:"Akun pengguna tidak ditemukan."});
        await send(SUPABASE_URL + "/rest/v1/bliyo_admins?on_conflict=user_id", {
          method:"POST", headers:{...adminHeaders,Prefer:"resolution=merge-duplicates,return=minimal"},
          body:JSON.stringify({user_id:target.id,email:target.email,created_by:caller.id})
        });
        return res.status(200).json({ok:true,message:"Hak admin berhasil diberikan."});
      }
      await send(SUPABASE_URL + "/rest/v1/bliyo_admins?user_id=eq." + encodeURIComponent(id), {
        method:"DELETE", headers:{...adminHeaders,Prefer:"return=minimal"}
      });
      return res.status(200).json({ok:true,message:"Hak admin berhasil dicabut."});
    }

    return res.status(400).json({ok:false,error:"Aksi tidak dikenal."});
  } catch (error) {
    console.error("BLIYO admin management:", error);
    return res.status(502).json({ok:false,error:String(error.message || "Kesalahan server").slice(0,220)});
  }
};
