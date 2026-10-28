import sys, glob, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from accad_load import load

D = 3.0; F = 1050.0; W, H = 720, 1280
UP = np.array([0, 0, 1.0])
def unit(v): return v / np.linalg.norm(v)
def h(v): return np.array([v[0], v[1], 0.0])

def angle2d(a, b, c):
    u, v = a - b, c - b
    return np.degrees(np.arccos(np.clip(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)), -1, 1)))

def analyse(path, angles):
    J, rate = load(path)
    T = len(J['nose'])
    pel = (J['Lhip'] + J['Rhip']) / 2
    name = os.path.basename(path)
    kick = name.startswith('G')
    if kick:
        cands = [('Lankle', 'Lhip'), ('Rankle', 'Rhip')]
        score = lambda e, r: np.nanmax(J[e][:, 2]) - J[e][0, 2]          # foot lift
    else:
        cands = [('Lwrist', 'Lshoulder'), ('Rwrist', 'Rshoulder')]
        score = lambda e, r: np.nanmax(np.linalg.norm(J[e] - J[r], axis=1)) - np.linalg.norm(J[e][0] - J[r][0])
    e, root = max(cands, key=lambda c: score(*c))
    side = e[0]
    ext = np.linalg.norm(J[e] - (J[root] if not kick else pel), axis=1)
    k = int(np.nanargmax(ext))                                         # peak frame
    rel = J[e] - pel
    bestd = np.linalg.norm(rel[k] - rel[0])
    # Target direction: where the strike lands, horizontally from its root.
    sd = unit(h(J[e][k] - (J[root][k] if not kick else pel[k])))
    f = sd
    la, ra = J['Lankle'][0], J['Rankle'][0]
    lead = 'L' if np.dot(la - ra, f) > 0 else 'R'
    rear = 'R' if lead == 'L' else 'L'
    perp = np.array([f[1], -f[0], 0])
    if np.dot(J[rear+'ankle'][0] - J[lead+'ankle'][0], perp) < 0: perp = -perp   # toward rear side
    limb = ('lead' if side == lead else 'rear') + ('_leg' if kick else '_arm')
    sl = unit(h(J[lead+'ankle'][0] - J[rear+'ankle'][0]))
    strike_vs_forward = np.degrees(np.arccos(np.clip(np.dot(sd, sl), -1, 1)))
    hip0 = pel[0]
    delta = (J[e][k] - J[e][0]) - (pel[k] - pel[0])
    rows = []
    for th in angles:
        t = np.radians(th)
        C = hip0 + D * (np.cos(t) * f + np.sin(t) * perp) + np.array([0, 0, 0.05])
        w = unit(h(hip0 - C))
        right = unit(np.cross(w, UP))
        def proj(P):
            q = P - C; d = q @ w
            return np.stack([W/2 + F * (q @ right) / d, H/2 - F * (q @ UP) / d], axis=-1), d
        vis_frac = np.linalg.norm(delta - np.dot(delta, w) * w) / np.linalg.norm(delta)
        # 2D joint angle at peak
        if 'wrist' in e:
            a2 = angle2d(*(proj(J[side+n][k])[0] for n in ('shoulder', 'elbow', 'wrist')))
            a3 = angle2d(*(J[side+n][k] for n in ('shoulder', 'elbow', 'wrist')))
        else:
            a2 = angle2d(*(proj(J[side+n][k])[0] for n in ('hip', 'knee', 'ankle')))
            a3 = angle2d(*(J[side+n][k] for n in ('hip', 'knee', 'ankle')))
        # Occlusion behind torso polygon, over the active window (frames moving)
        mv = np.linalg.norm(rel - rel[0], axis=1) > 0.2 * bestd
        frames = np.where(mv)[0]
        occ = {}
        for jn in ['wrist', 'elbow', 'knee', 'ankle']:
            for s, nm in ((lead, 'lead'), (rear, 'rear')):
                hid = 0
                for i in frames:
                    poly = np.array([proj(J[x][i])[0] for x in ('Lshoulder', 'Rshoulder', 'Rhip', 'Lhip')])
                    tdepth = np.mean([proj(J[x][i])[1] for x in ('Lshoulder', 'Rshoulder', 'Rhip', 'Lhip')])
                    p, d = proj(J[s+jn][i])
                    if d > tdepth + 0.08 and inside(p, poly): hid += 1
                occ[f'{nm}_{jn}'] = hid / max(1, len(frames))
        torso_px = np.linalg.norm(proj((J['Lshoulder'][0]+J['Rshoulder'][0])/2)[0] - proj(hip0)[0])
        p0 = proj(rel[0] + hip0)[0]; pk = proj(rel[k] + hip0)[0]
        rows.append(dict(angle=th, vis_frac=vis_frac, travel_torso=np.linalg.norm(pk - p0) / torso_px,
                         angle2d=a2, angle3d=a3, occ=occ))
    return dict(file=os.path.basename(path), effector=e, limb=limb, travel3d=bestd,
                strike_vs_forward=strike_vs_forward, rows=rows)

def inside(p, poly):
    x, y = p; n = len(poly); c = False
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

if __name__ == '__main__':
    angles = [int(a) for a in sys.argv[2].split(',')]
    for path in sorted(glob.glob(sys.argv[1])):
        try: r = analyse(path, angles)
        except Exception as ex: print('ERR', path, ex); continue
        print(f"\n{r['file']}  [{r['effector']} = {r['limb']}]  3D travel {r['travel3d']:.2f} m, strike vs stance line {r['strike_vs_forward']:.0f}°")
        print('  angle  visible%  travel(torso)  2Dangle(3D)   hidden>10%')
        for x in r['rows']:
            hid = ', '.join(f"{k} {v*100:.0f}%" for k, v in x['occ'].items() if v > 0.1)
            print(f"  {x['angle']:>4}°   {x['vis_frac']*100:5.0f}%     {x['travel_torso']:5.2f}       {x['angle2d']:4.0f}° ({x['angle3d']:3.0f}°)  {hid}")
