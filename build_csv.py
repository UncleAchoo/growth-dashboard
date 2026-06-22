import json, csv, calendar, os
D = "/sessions/serene-cool-keller/mnt/growth-dashboard/data/ytd2026_tmp"
HS = f"{D}/hs/all.tsv"
earliest = json.load(open(f"{D}/earliest_map.json"))
FIELDS = ["mutiny_app_id","hsid","name","domain","plan","monthly_payment",
          "monthly_payment_amount","seats_purchased","subscription_start_date",
          "start_date","reg_date"]
lookup = {}
for line in open(HS):
    parts = line.rstrip("\n").split("\t")
    while len(parts) < 11: parts.append("")
    rec = dict(zip(FIELDS, parts[:11]))
    cid = rec["mutiny_app_id"].strip().lower()
    if not cid: continue
    if cid in lookup:
        try: keep = int(rec["hsid"]) < int(lookup[cid]["hsid"])
        except ValueError: keep = False
        if keep: lookup[cid] = rec
    else:
        lookup[cid] = rec
def cohort_str(ym):
    y, mo = ym.split("-"); y=int(y); mo=int(mo)
    last = calendar.monthrange(y, mo)[1]
    return f"{mo}/{last}/{y}"
header = ["Month Of","Company name","HubSpot company id","Mutiny app id","Plan type",
          "MRR","Seat count","Subscription start date","Mutiny app registration date",
          "Cohort","Month"]
rows=[]; matched=0; unmatched=0
for cid, month_of in earliest.items():
    rec = lookup.get(cid); cohort = cohort_str(month_of)
    if rec is None:
        unmatched+=1
        company_name=hsid=plan=mrr=seats=sub_start=reg_date=""
    else:
        matched+=1
        company_name=rec["name"]; hsid=rec["hsid"]; plan=rec["plan"]
        raw = rec["monthly_payment"] if plan=="enterprise" else rec["monthly_payment_amount"]
        mrr = "0" if (raw is None or raw=="") else raw
        seats=rec["seats_purchased"]; sub_start=rec["subscription_start_date"] or rec["start_date"]; reg_date=rec["reg_date"]
    rows.append({"Month Of":month_of,"Company name":company_name,"HubSpot company id":hsid,
        "Mutiny app id":cid,"Plan type":plan,"MRR":mrr,"Seat count":seats,
        "Subscription start date":sub_start,"Mutiny app registration date":reg_date,
        "Cohort":cohort,"Month":cohort})
def sort_key(r):
    rd=r["Mutiny app registration date"]; return (rd=="", rd, r["Mutiny app id"])
rows.sort(key=sort_key)
paths=["/sessions/serene-cool-keller/mnt/growth-dashboard/amplitude_signups_ytd2026.csv",
       "/sessions/serene-cool-keller/mnt/outputs/amplitude_signups_ytd2026.csv"]
for p in paths:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p,"w",newline="") as f:
        w=csv.DictWriter(f, fieldnames=header, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for r in rows: w.writerow(r)
print("total rows:",len(rows)); print("matched:",matched); print("unmatched:",unmatched)
print("distinct hubspot lookup entries:",len(lookup))
for p in paths:
    print(p,"lines:",sum(1 for _ in open(p)),"bytes:",os.path.getsize(p))
