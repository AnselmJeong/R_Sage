# The three R Sage icon concepts on the macOS app icon grid.
import math, sys, os
OUT = sys.argv[1]
# macOS (Big Sur+) app icon grid: 1024 canvas, 824 body at 100, continuous-corner squircle.
def squircle(x0=100, y0=100, s=824, n=5.0, steps=720):
    a = s/2; cx = x0+a; cy = y0+a
    pts=[]
    for i in range(steps):
        t = 2*math.pi*i/steps
        c, sn = math.cos(t), math.sin(t)
        x = cx + a*math.copysign(abs(c)**(2/n), c)
        y = cy + a*math.copysign(abs(sn)**(2/n), sn)
        pts.append(f"{x:.2f},{y:.2f}")
    return "M"+" L".join(pts)+" Z"
def smooth_rect(x0=100, y0=100, w=824, h=824, r=185.4, xi=0.6):
    rad = math.radians
    p = (1+xi)*r
    arc = 90*(1-xi)
    arcLen = math.sin(rad(arc/2))*r*math.sqrt(2)
    alpha = (90-arc)/2
    p34 = r*math.tan(rad(alpha/2))
    beta = 45*xi
    c = p34*math.cos(rad(beta))
    d = c*math.tan(rad(beta))
    b = (p-arcLen-c-d)/3
    a = 2*b
    f = lambda v: f"{v:.3f}"
    return " ".join([
      f"M{f(x0+w-p)} {f(y0)}",
      f"c{f(a)} 0 {f(a+b)} 0 {f(a+b+c)} {f(d)}", f"a{r} {r} 0 0 1 {f(arcLen)} {f(arcLen)}", f"c{f(d)} {f(c)} {f(d)} {f(b+c)} {f(d)} {f(a+b+c)}",
      f"L{f(x0+w)} {f(y0+h-p)}",
      f"c0 {f(a)} 0 {f(a+b)} {f(-d)} {f(a+b+c)}", f"a{r} {r} 0 0 1 {f(-arcLen)} {f(arcLen)}", f"c{f(-c)} {f(d)} {f(-(b+c))} {f(d)} {f(-(a+b+c))} {f(d)}",
      f"L{f(x0+p)} {f(y0+h)}",
      f"c{f(-a)} 0 {f(-(a+b))} 0 {f(-(a+b+c))} {f(-d)}", f"a{r} {r} 0 0 1 {f(-arcLen)} {f(-arcLen)}", f"c{f(-d)} {f(-c)} {f(-d)} {f(-(b+c))} {f(-d)} {f(-(a+b+c))}",
      f"L{f(x0)} {f(y0+p)}",
      f"c0 {f(-a)} 0 {f(-(a+b))} {f(d)} {f(-(a+b+c))}", f"a{r} {r} 0 0 1 {f(arcLen)} {f(-arcLen)}", f"c{f(c)} {f(-d)} {f(b+c)} {f(-d)} {f(a+b+c)} {f(-d)}",
      "Z"])
SQ = smooth_rect()

def frame(defs, bg, art, edge="rgba(255,255,255,0.14)"):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <path id="body" d="{SQ}"/>
  <clipPath id="clip"><use href="#body"/></clipPath>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/>
  </filter>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.16"/>
    <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  {defs}
</defs>
<g filter="url(#shadow)"><use href="#body" fill="#000"/></g>
<g clip-path="url(#clip)">
  {bg}
  <rect x="0" y="0" width="1024" height="1024" fill="url(#gloss)"/>
  {art}
</g>
<use href="#body" fill="none" stroke="{edge}" stroke-width="2"/>
</svg>'''

def star(cx, cy, r, k=0.18):
    q = r*k
    return (f"M{cx},{cy-r} C{cx+q},{cy-q} {cx+q},{cy-q} {cx+r},{cy} "
            f"C{cx+q},{cy+q} {cx+q},{cy+q} {cx},{cy+r} "
            f"C{cx-q},{cy+q} {cx-q},{cy+q} {cx-r},{cy} "
            f"C{cx-q},{cy-q} {cx-q},{cy-q} {cx},{cy-r} Z")

R_D = "M372 724 L372 300 L512 300 A126 126 0 0 1 512 552 L372 552 M496 552 L644 724"

# A: sage leaf whose midrib is a data trend line
leaf = "M0,0 C130,-186 410,-150 540,0 C410,150 130,186 0,0 Z"
A = frame(
  '''<linearGradient id="bgA" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#7BA68B"/><stop offset="1" stop-color="#2C5444"/></linearGradient>
     <linearGradient id="leafA" x1="0" y1="0" x2="1" y2="0">
       <stop offset="0" stop-color="#EDE8D8"/><stop offset="1" stop-color="#FFFDF6"/></linearGradient>
     <filter id="soft" x="-40%" y="-60%" width="180%" height="220%">
       <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#0E2A20" flood-opacity="0.35"/></filter>''',
  '<rect width="1024" height="1024" fill="url(#bgA)"/>',
  f'''<g filter="url(#soft)"><g transform="translate(318 706) rotate(-45)">
       <path d="M-78,0 L0,0" stroke="#F6F2E6" stroke-width="26" stroke-linecap="round"/>
       <path d="{leaf}" fill="url(#leafA)"/>
       <polyline points="40,0 160,30 280,-26 400,14 505,0" fill="none" stroke="#3B6E58" stroke-width="20" stroke-linejoin="round" stroke-linecap="round"/>
       <g fill="#3B6E58" stroke="#FFFDF6" stroke-width="9">
         <circle cx="160" cy="30" r="19"/><circle cx="280" cy="-26" r="19"/><circle cx="400" cy="14" r="19"/></g>
     </g></g>''')

# B: ink R monogram with an AI spark
B = frame(
  '''<linearGradient id="bgB" x1="0" y1="0" x2="0.35" y2="1">
       <stop offset="0" stop-color="#34508F"/><stop offset="1" stop-color="#121A33"/></linearGradient>
     <radialGradient id="glowB" cx="0.68" cy="0.28" r="0.5">
       <stop offset="0" stop-color="#7FA2FF" stop-opacity="0.35"/><stop offset="1" stop-color="#7FA2FF" stop-opacity="0"/></radialGradient>
     <linearGradient id="inkB" gradientUnits="userSpaceOnUse" x1="0" y1="260" x2="0" y2="760">
       <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D6E0FA"/></linearGradient>
     <linearGradient id="sparkB" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#FFE3A3"/><stop offset="1" stop-color="#F2A93B"/></linearGradient>
     <filter id="soft" x="-40%" y="-60%" width="180%" height="220%">
       <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#050A1A" flood-opacity="0.45"/></filter>''',
  '<rect width="1024" height="1024" fill="url(#bgB)"/><rect width="1024" height="1024" fill="url(#glowB)"/>',
  f'''<g filter="url(#soft)" fill="none" stroke="url(#inkB)" stroke-width="76" stroke-linecap="round" stroke-linejoin="round" transform="translate(-44 0)">
       <path d="{R_D}"/></g>
     <path d="{star(722, 296, 84)}" fill="url(#sparkB)" filter="url(#soft)"/>
     <path d="{star(802, 412, 32)}" fill="#FFE3A3" opacity="0.85"/>''')

# C: light paper with sage R whose leg rises into a plotted point
grid = ''.join(f'<path d="M{x} 0 V1024" />' for x in range(132, 1024, 64)) + ''.join(f'<path d="M0 {y} H1024" />' for y in range(132, 1024, 64))
C = frame(
  f'''<linearGradient id="bgC" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#FFFEFA"/><stop offset="1" stop-color="#E9E6DC"/></linearGradient>
     <linearGradient id="inkC" gradientUnits="userSpaceOnUse" x1="0" y1="260" x2="0" y2="760">
       <stop offset="0" stop-color="#5E9677"/><stop offset="1" stop-color="#2F6049"/></linearGradient>
     <filter id="soft" x="-40%" y="-60%" width="180%" height="220%">
       <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#1F3B2E" flood-opacity="0.22"/></filter>''',
  f'<rect width="1024" height="1024" fill="url(#bgC)"/><g stroke="#2F6049" stroke-opacity="0.06" stroke-width="2">{grid}</g>',
  f'''<g filter="url(#soft)" fill="none" stroke="url(#inkC)" stroke-width="76" stroke-linecap="round" stroke-linejoin="round" transform="translate(-44 0)">
       <path d="{R_D}"/></g>
     <path d="{star(722, 296, 84)}" fill="#E39A3B" filter="url(#soft)"/>''',
  edge="rgba(0,0,0,0.10)")

os.makedirs(OUT, exist_ok=True)
for k, v in dict(A=A, B=B, C=C).items():
    open(f"{OUT}/concept-{k}.svg", "w").write(v)
