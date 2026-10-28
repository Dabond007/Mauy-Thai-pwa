"""Load ACCAD Plug-in-Gait C3D into MediaPipe-like joints (metres, z up)."""
import ezc3d, numpy as np

def fill(x):
    # Linear interpolation over marker dropouts, edges held.
    t = np.arange(len(x))
    for c in range(x.shape[1]):
        ok = ~np.isnan(x[:, c])
        if ok.any() and not ok.all():
            x[:, c] = np.interp(t, t[ok], x[ok, c])
    return x

def load(path):
    c = ezc3d.c3d(path)
    pts = c['data']['points'][:3] / 1000.0          # (3, M, T) metres
    labels = [l.split(':')[-1] for l in c['parameters']['POINT']['LABELS']['value']]
    rate = c['header']['points']['frame_rate']
    idx = {l: i for i, l in enumerate(labels)}
    def m(*names):
        a = np.stack([pts[:, idx[n], :] for n in names])  # (k,3,T)
        a[a == 0] = np.nan
        with np.errstate(all='ignore'):
            import warnings; warnings.simplefilter('ignore')
            out = np.nanmean(a, axis=0).T                # (T,3)
        return fill(out)
    J = {}
    J['head'] = m('LFHD', 'RFHD', 'LBHD', 'RBHD')
    J['nose'] = m('LFHD', 'RFHD') - np.array([0, 0, 0.07])
    for s in 'LR':
        J[s+'shoulder'] = m(s+'SHO')
        J[s+'elbow'] = m(s+'ELB')
        J[s+'wrist'] = m(s+'WRA', s+'WRB')
        J[s+'hip'] = m(s+'FWT', s+'BWT') - np.array([0, 0, 0.08])
        J[s+'knee'] = m(s+'KNE')
        J[s+'ankle'] = m(s+'ANK')
        J[s+'heel'] = m(s+'HEE')
        J[s+'toe'] = m(s+'TOE')
    return J, rate
