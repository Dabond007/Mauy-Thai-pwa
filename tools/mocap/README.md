# Camera-angle analysis from motion capture

Places a virtual phone (portrait, 3 m away, waist height) around expert
motion-capture recordings and measures, per move and per angle, how much of
the strike travels across the picture (which pose detection measures well)
versus toward the camera (which it measures badly), the 2D joint angle the
camera would see at the strike's peak, and which limbs hide behind the torso.

    pip install ezc3d numpy
    tools/mocap/fetch_accad.sh
    cd tools/mocap/data && python3 ../accad_angles.py "E[1-8] -*" -30,0,15,30,45,60

Angles are measured from the strike's target direction; positive = phone on
the fighter's rear-hand side. Results and conclusions:
docs/research/camera-angle.md.

Data: ACCAD Open Motion Project, The Ohio State University, licensed CC BY
3.0 (https://accad.osu.edu/research/motion-lab/mocap-system-and-data).
