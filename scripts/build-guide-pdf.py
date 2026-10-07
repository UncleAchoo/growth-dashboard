# Regenerates public/dashboard-guide.pdf (the "How to read this dashboard" one-pager).
# Needs the Mutiny brand fonts as TTF in /tmp/fonts (Reckless + Affix converted from the
# brand OTFs, KMR Waldenburg regular/bold TTF). Run from the repo root: python3 scripts/build-guide-pdf.py
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, black, white
from reportlab.platypus import Paragraph, Table, TableStyle, Frame, KeepInFrame, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch

for n, f in [('Reck', '/tmp/fonts/Reckless.ttf'), ('Affix', '/tmp/fonts/Affix.ttf'),
             ('Wal', '/tmp/fonts/kmrwaldenburg-regular.ttf'), ('WalB', '/tmp/fonts/kmrwaldenburg-bold.ttf')]:
    pdfmetrics.registerFont(TTFont(n, f))
from reportlab.lib.fonts import addMapping
addMapping('Wal', 0, 0, 'Wal'); addMapping('Wal', 1, 0, 'WalB'); addMapping('Wal', 0, 1, 'Wal'); addMapping('Wal', 1, 1, 'WalB')

PURPLE = HexColor('#A73BF5'); GREEN = HexColor('#B2FF14'); LPURPLE = HexColor('#F2D1FC')
LBLUE = HexColor('#BCEEFD'); LGREEN = HexColor('#D2FD78'); GREY = HexColor('#EFEFEF'); MUTED = HexColor('#5A5A5A')
PAPER = HexColor('#FAF8F4')

OUT = 'public/dashboard-guide.pdf'  # run from the repo root
W, H = letter
M = 0.55 * inch
c = canvas.Canvas(OUT, pagesize=letter)
c.setTitle('How to read the growth dashboard'); c.setAuthor('Mutiny Growth')

# background
c.setFillColor(PAPER); c.rect(0, 0, W, H, stroke=0, fill=1)

body = ParagraphStyle('b', fontName='Wal', fontSize=9.2, leading=12.4, textColor=black)
small = ParagraphStyle('s', parent=body, fontSize=8.4, leading=11.2)
h2 = ParagraphStyle('h2', fontName='WalB', fontSize=11.5, leading=14, textColor=black, spaceAfter=5)
cap = ParagraphStyle('cap', fontName='Affix', fontSize=8, leading=10.5, textColor=MUTED)
term = ParagraphStyle('t', parent=body, fontName='WalB', fontSize=8.8, leading=11.4)
defn = ParagraphStyle('d', parent=body, fontSize=8.6, leading=11.4)

y = H - M
# eyebrow
c.setFont('WalB', 8); c.setFillColor(MUTED)
c.drawString(M, y - 8, 'MUTINY  ·  GROWTH  ·  BETA DASHBOARD')
# title
c.setFont('Reck', 34); c.setFillColor(black)
c.drawString(M, y - 44, 'How to read the growth dashboard')
c.setFont('Wal', 9.5); c.setFillColor(MUTED)
c.drawString(M, y - 60, 'uncleachoo.github.io/growth-dashboard/?beta  —  a 2-minute guide. Read it top to bottom: people, then companies.')
y -= 76

# --- Funnel strip -----------------------------------------------------------
def box(x, yy, w, h, title, sub, fill):
    c.setFillColor(fill); c.setStrokeColor(black); c.setLineWidth(0.8)
    c.roundRect(x, yy, w, h, 4, stroke=1, fill=1)
    c.setFillColor(black); c.setFont('WalB', 9.5); c.drawString(x + 8, yy + h - 14, title)
    c.setFont('Wal', 7.6); c.setFillColor(HexColor('#333333'))
    tx = c.beginText(x + 8, yy + h - 25); tx.setFont('Wal', 7.6); tx.setLeading(9.2)
    for line in sub: tx.textLine(line)
    c.drawText(tx)

def arrow(x1, x2, yy):
    c.setStrokeColor(black); c.setLineWidth(1.1); c.line(x1, yy, x2 - 4, yy)
    p = c.beginPath(); p.moveTo(x2, yy); p.lineTo(x2 - 5, yy + 3); p.lineTo(x2 - 5, yy - 3); p.close()
    c.setFillColor(black); c.drawPath(p, stroke=0, fill=1)

strip_h = 50; gap = 16
labw = 64
row_users = [('Website visitors', ['Engaged sessions', '(GA4)']), ('Sign ups', ['People joining a', 'workspace']),
             ('Activated', ['First email sent or', 'asset published']), ('Returned', ['Came back within', '7 days of activating'])]
row_cos = [('Paying', ['Self-serve companies', 'billed in Stripe']), ('Retained', ['Still paying the', 'next month']),
           ('Expanding', ['Grow seats / plan', '(coming soon)'])]
avail = W - 2 * M - labw
bw = (avail - gap * 3) / 4
for ri, (label, row, fill) in enumerate([('PEOPLE', row_users, LPURPLE), ('COMPANIES', row_cos, LGREEN)]):
    yy = y - strip_h - ri * (strip_h + 10)
    c.setFont('WalB', 8); c.setFillColor(MUTED); c.drawString(M, yy + strip_h / 2 - 3, label)
    for i, (t, sub) in enumerate(row):
        x = M + labw + i * (bw + gap)
        box(x, yy, bw, strip_h, t, sub, fill if t != 'Expanding' else GREY)
        if i < len(row) - 1: arrow(x + bw + 2, x + bw + gap - 2, yy + strip_h / 2)
y -= 2 * strip_h + 10 + 14
c.setFont('Affix', 8.2); c.setFillColor(MUTED)
c.drawString(M + labw, y, 'The boxes at the top of the dashboard show this funnel. Click any step to open its charts below.')
y -= 16

# --- Two columns ---------------------------------------------------------------
colgap = 0.3 * inch
colw = (W - 2 * M - colgap) / 2
top = y
bottom_reserved = 1.32 * inch  # watch-outs band

def section_card(x, ytop, w, flow, fill=white, pad=10, height=None):
    kif = KeepInFrame(w - 2 * pad, 10 * inch, flow, mode='shrink')
    _, hh = kif.wrapOn(c, w - 2 * pad, 10 * inch)
    hh = height or hh + 2 * pad
    c.setFillColor(fill); c.setStrokeColor(black); c.setLineWidth(0.8)
    c.roundRect(x, ytop - hh, w, hh, 4, stroke=1, fill=1)
    kif.drawOn(c, x + pad, ytop - hh + pad + ((hh - 2 * pad) - kif.wrapOn(c, w - 2 * pad, 10 * inch)[1]))
    return hh

bul = lambda t: Paragraph(f'<font name="WalB" color="#A73BF5">→</font>&nbsp; {t}', body)

# Left column: time frame + reading tips
left1 = [Paragraph('1. Pick a time frame <font name="Wal" size="8.5" color="#5A5A5A">(top right)</font>', h2)]
tf = [
    ('Last week', 'Weekly check-in: what moved since last week.'),
    ('Last 4 weeks', '<b>Default.</b> The trend, without weekly noise.'),
    ('Q3 to date', 'Fiscal quarter so far (Q3 = Aug–Oct; Q1 starts Feb 1).'),
    ('Fiscal YTD', 'Since Feb 1. No comparison — there is no prior-year data.'),
]
t = Table([[Paragraph(a, term), Paragraph(b, defn)] for a, b in tf], colWidths=[0.95 * inch, colw - 20 - 0.95 * inch])
t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                       ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                       ('LINEBELOW', (0, 0), (-1, -2), 0.4, GREY)]))
left1 += [t, Spacer(1, 5), Paragraph('Headlines use <b>complete Mon–Sun weeks</b>. The week in progress appears separately as "Week to date". '
                                     'Green / red arrows compare with the same stretch of time just before.', small)]

left2 = [Paragraph('3. Reading tips', h2),
         bul('<b>Hover a headline number</b> (dotted underline) for a one-line, plain-English read.'),
         bul('<b>"X still open"</b> = signups too recent to judge yet. They are left out of the rate, not counted as misses.'),
         bul('<b>Striped or faded</b> bars and cells = still in progress.'),
         bul('<b>"All cohorts" / "To date" chips</b> = that card ignores the time frame.'),
         bul('<b>Click</b> bars, table rows or heat-map cells to see the people or companies behind them.')]

# Right column: definitions
defs = [
    ('Website visitors', 'GA4 engaged sessions — real visits, not bot-inflated raw traffic.'),
    ('Sign up', 'A person joining a company workspace. Someone joining two companies counts twice. Mutiny staff excluded.'),
    ('Activated', 'Sent (or drafted) a first email, or published an asset.'),
    ('Returned', 'An activated user who comes back within 7 days and does something meaningful.'),
    ('Channel', 'The signup\'s own answer to "How did you hear about us?" (asked since May 7, 2026). Invited / joining teammates are never asked.'),
    ('Paying company', 'Self-serve customer billed in Stripe (MRR above $0). Enterprise excluded — same rule as the revenue dashboard.'),
    ('Retention', 'Share of companies still paying the month after they started (Month 1), by start month.'),
    ('Credits used', 'Share of a billing cycle\'s credits a paying company actually used.'),
]
right = [Paragraph('2. What the numbers mean', h2)]
dt = Table([[Paragraph(a, term), Paragraph(b, defn)] for a, b in defs], colWidths=[1.05 * inch, colw - 20 - 1.05 * inch])
dt.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                        ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
                        ('LINEBELOW', (0, 0), (-1, -2), 0.4, GREY)]))
right.append(dt)

h_l1 = section_card(M, top, colw, left1, fill=white)
h_l2 = section_card(M, top - h_l1 - 10, colw, left2, fill=white)
h_r = section_card(M + colw + colgap, top, colw, right, fill=white, height=h_l1 + 10 + h_l2)
y = top - (h_l1 + 10 + h_l2) - 12

# --- Watch-outs band -----------------------------------------------------------
wo = [Paragraph('4. Read with care', h2),
      Table([[bul('<b>Small numbers.</b> Company-level cards (paying, retention, "does activation predict paid") rest on dozens of companies — read them as direction, not precision.'),
              bul('<b>Website traffic</b> drops sharply from Aug 2026 — being checked; possibly a GA4 tracking change. Compare visitors within, not across, that line.')],
             [bul('<b>Channels before May 7, 2026</b> are mostly blank — the question didn\'t exist yet.'),
              bul('<b>Freshness:</b> "Data as of" in the header shows each source\'s latest day. Data refreshes when the growth team runs the update.')]],
            colWidths=[(W - 2 * M - 20) / 2] * 2,
            style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                              ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))]
section_card(M, y, W - 2 * M, wo, fill=LBLUE)

# footer
c.setFont('Affix', 7.8); c.setFillColor(MUTED)
c.drawString(M, M * 0.55, 'Mutiny Growth · beta dashboard guide · Oct 2026')
c.drawRightString(W - M, M * 0.55, 'Questions: Nick (nick@mutinyhq.com)')
c.showPage(); c.save()
print('wrote', OUT)
