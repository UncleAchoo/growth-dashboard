import json, datetime

def dates_from(start, n):
    s = datetime.date(*map(int,[start[:4],start[4:6],start[6:8]]))
    return [(s+datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(n)]

def series(start, vals):
    return {dt: v for dt, v in zip(dates_from(start, len(vals)), vals)}

# ---- YTD cumulative deduped-unique USC (Jan1 -> Jul8), as-of Jul8 (189 days) ----
cum = [0]*46 + [
 10,84,144,224,273,282,287,314,351,362,400,414,416,417,435,452,479,485,501,503,505,519,534,559,
 570,577,577,577,588,595,608,611,616,617,617,625,633,648,671,678,681,686,700,707,724,742,755,759,
 761,779,1153,1550,1687,1773,1811,1851,1938,2018,2105,2175,2217,2230,2249,2296,2328,2372,2417,2455,
 2462,2475,2508,2538,2584,2643,2657,2670,2681,2714,2745,2774,2817,2841,2845,2851,2876,2913,2939,2975,
 2995,3003,3009,3023,3056,3085,3121,3138,3139,3142,3154,3187,3219,3245,3255,3257,3265,3303,3326,3359,
 3384,3407,3412,3419,3438,3462,3478,3493,3504,3508,3509,3528,3546,3567,3581,3596,3605,3608,3621,3641,
 3656,3714,3764,3775,3785,3821,3858,3884,3907,3911,3914,3918,3939,3966,3980]
assert len(cum)==189, len(cum)
assert cum[45]==0 and cum[46]==10 and cum[180]==3858 and cum[-1]==3980

# within-window cumulative-unique series (isCumulative queries)
last30 = [21,48,65,81,92,97,98,117,135,156,170,185,194,197,210,232,248,306,358,369,379,417,457,485,510,514,517,521,542,571,585]
mtd    = [29,55,59,62,66,87,118,134]
assert len(last30)==31 and last30[-1]==585
assert len(mtd)==8 and mtd[-1]==134

# CSC daily uniques tail (overwrite Jul1..Jul8; June untouched -> stays 496 sum)
csc_tail = series("20260701", [17,6,4,3,4,15,17,8])

d = json.load(open("src/data.json"))

# ---------------- dedup ----------------
prev_note = d["amplitude"]["dedup"].get("note")
d["amplitude"]["dedup"] = {
 "periods": {
  "20260601_20260607":163,"20260608_20260614":98,"20260615_20260621":101,
  "20260622_20260628":186,"20260629_20260705":148,"20260706_20260712":70,
  "20260101_20260131":0,"20260201_20260228":416,"20260301_20260331":294,
  "20260401_20260430":1939,"20260501_20260531":643,"20260601_20260630":615,
  "20260701_20260731":134,
 },
 "windows": {"last30":585,"prior30":594,"mtd":134,"ytd":3980,"fourweeks":585},
 "note": prev_note,
 "cumulativeDaily": {dt:v for dt,v in zip(dates_from("20260101",189), cum)},
 "cumulativeWindow": {
   "last30": series("20260608", last30),
   "mtd":    series("20260701", mtd),
 },
 "regeneratedAt": datetime.datetime.utcnow().isoformat()+"Z",
 "regeneratedVia": "amplitude MCP eventsSegmentation uniques (isCumulative), window=Jul8",
}

# companySetupDaily: overwrite July tail only
for k,v in csc_tail.items():
    d["amplitude"]["companySetupDaily"][k] = v
june_sod = sum(v for k,v in d["amplitude"]["companySetupDaily"].items() if k.startswith("202606"))

# ---------------- roles windows (last30 / fourweeks / ytd via MCP) ----------------
last30_roles = {"other":136,"founder":131,"abm":91,"demand_gen":82,"ae":92,"product_marketing":60,"bdr_sdr":39}
ytd_roles    = {"founder":1129,"other":723,"ae":542,"abm":521,"demand_gen":489,"product_marketing":479,"bdr_sdr":205,"none":117}
r = d["amplitude"]["roles"]
r["windows"]["last30"]    = last30_roles
r["windows"]["fourweeks"] = dict(last30_roles)   # identical range Jun8-Jul8
r["windows"]["ytd"]       = ytd_roles
r.pop("windowsCarriedForward", None)
r["windowsRegeneratedAt"]  = datetime.datetime.utcnow().isoformat()+"Z"
r["windowsRegeneratedVia"] = "amplitude MCP eventsSegmentation uniques (isCumulative, group_by user_work_role), window=Jul8"

json.dump(d, open("src/data.json","w"), ensure_ascii=False)

# ---- reconciliation report ----
print("dedup.windows:", d["amplitude"]["dedup"]["windows"])
print("cumDaily end:", cum[-1], "== ytd window", d["amplitude"]["dedup"]["windows"]["ytd"])
print("cumWindow last30 end:", last30[-1], "| mtd end:", mtd[-1])
print("June CSC sum-of-daily (want 496):", june_sod)
print("roles last30 sum:", sum(last30_roles.values()), ">= dedup last30", 585)
print("roles ytd sum:", sum(ytd_roles.values()), ">= dedup ytd", 3980)
print("roles.windows keys:", list(r["windows"].keys()))
