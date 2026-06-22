import re,sys
D="/sessions/serene-cool-keller/mnt/growth-dashboard/data/ytd2026_tmp"
uu=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
months=[("2026-01","jan_final.txt"),("2026-02","feb_final.txt"),("2026-03","mar_final.txt"),
        ("2026-04","apr_final.txt"),("2026-05","may_final.txt"),("2026-06","jun_final.txt")]
earliest={}
dropped=0
permonth_raw={}
for mlabel,fn in months:
    ids=[]
    try:
        for line in open(f"{D}/{fn}"):
            v=line.strip().lower()
            if not v: continue
            if v=="(none)":
                globals()['dropped']=dropped
                dropped+=1; continue
            if not uu.match(v):
                dropped+=1; continue
            ids.append(v)
    except FileNotFoundError:
        ids=[]
    permonth_raw[mlabel]=len(set(ids))
    for cid in set(ids):
        if cid not in earliest:
            earliest[cid]=mlabel  # months processed in chronological order => first assignment is earliest
# per-month earliest counts
from collections import Counter
cnt=Counter(earliest.values())
print("=== raw distinct per file ===")
for m,_ in months: print(m, permonth_raw[m])
print("=== earliest-assigned per month ===")
for m,_ in months: print(m, cnt.get(m,0))
print("total distinct:",len(earliest))
print("dropped (none)/empty:",dropped)
# write map
import json
with open(f"{D}/earliest_map.json","w") as f:
    json.dump(earliest,f)
print("map written:",f"{D}/earliest_map.json")
