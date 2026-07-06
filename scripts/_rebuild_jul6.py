import json, datetime

def dates_from(start, n):
    s = datetime.date(*map(int,[start[:4],start[4:6],start[6:8]]))
    return [(s+datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(n)]

# YTD cumulative deduped-unique USC (Jan1 -> Jul6), 187 days
cum = [0]*46 + [
 10,84,144,224,273,282,287,314,351,362,400,414,416,417,435,452,479,485,501,503,505,519,534,559,
 570,577,577,577,588,595,608,611,616,617,617,625,633,648,671,678,681,686,700,707,724,742,755,759,
 761,779,1153,1550,1687,1773,1811,1851,1938,2018,2105,2175,2217,2230,2249,2296,2328,2372,2417,2455,
 2462,2475,2508,2538,2584,2643,2657,2670,2681,2714,2745,2774,2817,2841,2845,2851,2876,2913,2939,2975,
 2995,3003,3009,3023,3056,3085,3121,3138,3139,3142,3154,3187,3219,3245,3255,3257,3265,3303,3326,3359,
 3384,3407,3412,3419,3438,3462,3478,3493,3504,3508,3509,3528,3546,3567,3581,3596,3605,3608,3621,3641,
 3656,3714,3764,3775,3785,3821,3858,3884,3907,3911,3914,3918,3926]
assert len(cum)==187, len(cum)
assert cum[45]==0 and cum[46]==10 and cum[180]==3858 and cum[186]==3926

# CSC daily uniques (Jan1 -> Jul6), 187 days
csc = [0]*46 + [
 6,56,31,63,30,8,3,17,27,5,22,6,3,0,12,4,14,3,9,1,2,8,10,10,6,3,0,0,6,7,9,1,1,0,0,5,1,9,20,7,2,6,9,7,
 13,9,9,4,1,7,384,392,126,73,37,45,85,81,87,62,36,12,18,38,28,36,43,30,9,15,26,24,52,41,15,11,11,30,
 21,25,33,20,6,10,24,33,24,25,19,9,5,10,27,12,28,13,1,3,15,29,24,17,8,2,11,26,16,23,19,13,5,9,16,18,
 17,13,7,5,4,8,13,13,16,16,10,3,14,19,19,56,42,12,9,25,30,17,6,4,3,4,7]
assert len(csc)==187, len(csc)

# within-window cumulative-unique series
last30 = [5,12,33,60,77,93,104,109,110,129,147,168,182,197,206,209,222,244,260,318,370,381,391,429,469,497,522,526,529,533,541]
mtd    = [29,55,59,62,66,74]
assert last30[-1]==541 and mtd[-1]==74

ytd_dates    = dates_from("20260101", 187)
last30_dates = dates_from("20260606", 31)
mtd_dates    = dates_from("20260701", 6)
assert len(last30)==31 and len(mtd)==6

d = json.load(open("src/data.json"))
note = d["amplitude"]["dedup"].get("note")
june_sod = sum(csc[151:181])  # Jun1..Jun30 sum-of-daily
d["amplitude"]["dedup"] = {
 "periods": {
  "20260601_20260607":163,"20260608_20260614":98,"20260615_20260621":101,
  "20260622_20260628":186,"20260629_20260705":148,"20260706_20260712":8,
  "20260101_20260131":0,"20260201_20260228":416,"20260301_20260331":294,
  "20260401_20260430":1939,"20260501_20260531":643,"20260601_20260630":615,
  "20260701_20260731":74,
 },
 "windows": {"last30":541,"prior30":650,"mtd":74,"ytd":3926,"fourweeks":529},
 "note": note,
 "cumulativeDaily": {dt:v for dt,v in zip(ytd_dates,cum)},
 "cumulativeWindow": {
   "last30": {dt:v for dt,v in zip(last30_dates,last30)},
   "mtd":    {dt:v for dt,v in zip(mtd_dates,mtd)},
 },
 "regeneratedAt": datetime.datetime.utcnow().isoformat()+"Z",
 "regeneratedVia": "amplitude MCP eventsSegmentation uniques (isCumulative), window=Jul6",
}
d["amplitude"]["companySetupDaily"] = {dt:v for dt,v in zip(ytd_dates,csc)}
json.dump(d, open("src/data.json","w"), ensure_ascii=False)
print("windows:", d["amplitude"]["dedup"]["windows"])
print("cumDaily end:", ytd_dates[-1], cum[-1], "| last30 end:", last30[-1], "| mtd end:", mtd[-1])
print("companySetupDaily end:", ytd_dates[-1], csc[-1], "| June sum-of-daily =", june_sod)
