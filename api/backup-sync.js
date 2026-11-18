const SUPABASE_URL = "https://wgeqrtlqdhnlzedgnrmm.supabase.co";
const SUPABASE_KEY = "sb_publishable_tT3y2YtcCaB49bQKrYq92A_fdPlJPNQ";
const ADMIN_UID = "b0a2f77e-ef24-4b84-9c11-58626166184d";
const WORKER_URL = "https://bliyo-market-api.khaelzgc.workers.dev";
const TABLES = {
  products: "id,name,category,price,min_qty,max_qty,rating,sold,image,description,updated_at",
  categories: "id,name,created_at",
  banners: "id,image,link,position,created_at",
  store_settings: "id,store,phone,updated_at",
  user_profiles: "id,email,name,created_at,updated_at",
  orders: "id,user_id,name,email,product,price,qty,total,status,date_label,message,created_at"
};
const PAGE_SIZE = 500;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ok:false,error:"Method not allowed"});
  }
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) return res.status(503).json({ok:false,error:"Backup API not configured"});
  const auth = req.headers.authorization || "";
  const sessionToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!sessionToken) return res.status(401).json({ok:false,error:"Admin session required"});

  try {
    const verify = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers:{apikey:SUPABASE_KEY,Authorization:"Bearer " + sessionToken}
    });
    if (!verify.ok) return res.status(401).json({ok:false,error:"Session invalid"});
    const account = await verify.json();
    if (account.id !== ADMIN_UID) return res.status(403).json({ok:false,error:"Admin only"});

    const summary = {};
    for (const [table, columns] of Object.entries(TABLES)) {
      let offset = 0, total = 0;
      while (true) {
        const params = new URLSearchParams({
          select:columns,
          order:"id.asc",
          limit:String(PAGE_SIZE),
          offset:String(offset)
        });
        const source = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?" + params, {
          headers:{apikey:SUPABASE_KEY,Authorization:"Bearer " + sessionToken}
        });
        if (!source.ok) {
          const detail = await source.text();
          throw new Error("Read " + table + " failed: " + detail.slice(0,180));
        }
        const rows = await source.json();
        if (!Array.isArray(rows)) throw new Error("Invalid source data: " + table);
        for (let i=0;i<rows.length;i+=100) {
          const batch = rows.slice(i,i+100);
          if (!batch.length) continue;
          const pushed = await fetch(WORKER_URL + "/sync", {
            method:"POST",
            headers:{"content-type":"application/json",authorization:"Bearer " + apiToken},
            body:JSON.stringify({table,rows:batch})
          });
          if (!pushed.ok) {
            const detail = await pushed.text();
            throw new Error("Write " + table + " failed: " + detail.slice(0,180));
          }
        }
        total += rows.length;
        offset += rows.length;
        if (rows.length < PAGE_SIZE) break;
      }
      summary[table] = total;
    }
    return res.status(200).json({ok:true,summary});
  } catch (error) {
    console.error("BLIYO backup:",error);
    return res.status(502).json({ok:false,error:"Backup failed",detail:String(error.message||"unknown").slice(0,240)});
  }
};
