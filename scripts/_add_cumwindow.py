import json, datetime

def series(start, vals):
    s = datetime.date(*map(int,[start[:4],start[4:6],start[6:8]]))
    return {(s+datetime.timedelta(days=i)).strftime("%Y%m%d"): v for i,v in enumerate(vals)}

# within-window cumulative-unique USC (from isCumulative Amplitude queries)
last30 = series("20260602", [24,60,88,113,118,125,144,171,188,204,215,220,221,240,258,
                             279,293,308,317,320,333,354,370,428,480,491,501,539,578,606,608])
mtd    = series("20260701", [29,32])
assert last30["20260702"] == 608 and mtd["20260702"] == 32

d = json.load(open("src/data.json"))
d["amplitude"]["dedup"]["cumulativeWindow"] = {"last30": last30, "mtd": mtd}
json.dump(d, open("src/data.json","w"), ensure_ascii=False)
print("cumulativeWindow added: last30 end", last30["20260702"], "| mtd end", mtd["20260702"])
