from __future__ import annotations

from pathlib import Path
import math
import trimesh

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
OUT.mkdir(parents=True, exist_ok=True)

SILVER = [0.82, 0.84, 0.88, 1.0]
PEARL = [0.96, 0.95, 0.92, 1.0]


def material(color):
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=color,
        metallicFactor=0.85 if color == SILVER else 0.05,
        roughnessFactor=0.25,
    )


def box(extents, color=SILVER):
    mesh = trimesh.creation.box(extents=extents)
    mesh.visual.material = material(color)
    return mesh


def sphere(color, radius=1.0):
    mesh = trimesh.creation.icosphere(subdivisions=0, radius=radius)
    mesh.visual.material = material(color)
    return mesh


def export(name, meshes):
    scene = trimesh.Scene()
    for index, mesh in enumerate(meshes):
        scene.add_geometry(mesh, node_name=f'g{index}')
    path = OUT / f'{name}.glb'
    path.write_bytes(scene.export(file_type='glb'))
    print(f'GLB {name}: {path.stat().st_size} bytes')


def yc9561e():
    pearl = sphere(PEARL)
    pearl.apply_scale([1.0, 1.0, 0.7])
    export('YC9561E', [pearl])


def eh4520():
    meshes = []
    for i in range(5):
        arm = box([0.22, 1.6, 0.18])
        arm.apply_translation([0, 0.45, 0])
        arm.apply_transform(trimesh.transformations.rotation_matrix(i * 2 * math.pi / 5, [0, 0, 1]))
        meshes.append(arm)
    export('EH-4520', meshes)


def yc3536e_1():
    left = box([0.78, 0.46, 0.22]); left.apply_translation([-0.5, 0, 0])
    right = box([0.78, 0.46, 0.22]); right.apply_translation([0.5, 0, 0])
    knot = box([0.25, 0.25, 0.28])
    export('YC3536E_1', [left, right, knot])


def yc8320e_1():
    meshes = []
    for x in [-0.45, 0.45]:
        upper = box([0.62, 0.42, 0.18]); upper.apply_translation([x, 0.2, 0]); meshes.append(upper)
        lower = box([0.46, 0.32, 0.16]); lower.apply_translation([x * 0.8, -0.34, 0]); meshes.append(lower)
    pearl = sphere(PEARL, 0.25); pearl.apply_translation([0, -0.72, 0]); meshes.append(pearl)
    export('YC8320E_1', meshes)


def yc5295e_1():
    stud = box([0.26, 0.26, 0.18])
    chain = box([0.08, 4.5, 0.08]); chain.apply_translation([0, -2.35, 0])
    pearl = sphere(PEARL, 0.28); pearl.apply_translation([0, -4.75, 0])
    export('YC5295E_1', [stud, chain, pearl])


def yc4413e_1():
    meshes = []
    for y in [-0.75, 0.75]:
        part = box([1.6, 0.12, 0.18]); part.apply_translation([0, y, 0]); meshes.append(part)
    for x in [-0.75, 0.75]:
        part = box([0.12, 1.6, 0.18]); part.apply_translation([x, 0, 0]); meshes.append(part)
    pearl = sphere(PEARL, 0.34); meshes.append(pearl)
    export('YC4413E_1', meshes)


if __name__ == '__main__':
    yc4413e_1()
    yc3536e_1()
    yc5295e_1()
    yc9561e()
    yc8320e_1()
    eh4520()
