from __future__ import annotations

from pathlib import Path
import math
import trimesh

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
OUT.mkdir(parents=True, exist_ok=True)

SILVER = [0.88, 0.90, 0.93, 1.0]
GOLD = [0.92, 0.66, 0.24, 1.0]
PEARL = [0.98, 0.96, 0.91, 1.0]


def material(color):
    is_metal = color in (SILVER, GOLD)
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=color,
        metallicFactor=0.62 if is_metal else 0.02,
        roughnessFactor=0.28 if is_metal else 0.20,
    )


def box(extents, color=SILVER):
    mesh = trimesh.creation.box(extents=extents)
    mesh.visual.material = material(color)
    return mesh


def sphere(color, radius=1.0):
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=radius)
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
    pearl.apply_scale([1.0, 1.0, 0.72])
    export('YC9561E', [pearl])


def eh4520():
    meshes = []
    for i in range(5):
        arm = box([0.20, 1.52, 0.14], SILVER)
        arm.apply_translation([0, 0.42, 0])
        arm.apply_transform(trimesh.transformations.rotation_matrix(i * 2 * math.pi / 5, [0, 0, 1]))
        meshes.append(arm)
    export('EH-4520', meshes)


def yc3536e_1():
    # 蝴蝶結改用圓滑葉片，不再用矩形 box，避免手機上看成黑框/方塊。
    left = sphere(SILVER)
    left.apply_scale([0.66, 0.36, 0.16])
    left.apply_translation([-0.42, 0, 0])
    right = sphere(SILVER)
    right.apply_scale([0.66, 0.36, 0.16])
    right.apply_translation([0.42, 0, 0])
    knot = sphere(SILVER, 0.20)
    knot.apply_scale([1.0, 0.9, 0.8])
    export('YC3536E_1', [left, right, knot])


def yc8320e_1():
    meshes = []
    for x in [-0.42, 0.42]:
        upper = sphere(SILVER)
        upper.apply_scale([0.54, 0.34, 0.14])
        upper.apply_translation([x, 0.18, 0])
        meshes.append(upper)
        lower = sphere(SILVER)
        lower.apply_scale([0.42, 0.28, 0.13])
        lower.apply_translation([x * 0.82, -0.30, 0])
        meshes.append(lower)
    pearl = sphere(PEARL, 0.24)
    pearl.apply_translation([0, -0.66, 0])
    meshes.append(pearl)
    export('YC8320E_1', meshes)


def yc5295e_1():
    stud = sphere(SILVER, 0.15)
    chain = box([0.07, 4.45, 0.07], SILVER)
    chain.apply_translation([0, -2.30, 0])
    pearl = sphere(PEARL, 0.28)
    pearl.apply_translation([0, -4.70, 0])
    export('YC5295E_1', [stud, chain, pearl])


def yc4413e_1():
    # 這款原圖為金色方框珍珠；改用金色材質，避免 metallic 無環境光時看成黑框。
    meshes = []
    for y in [-0.75, 0.75]:
        part = box([1.60, 0.12, 0.16], GOLD)
        part.apply_translation([0, y, 0])
        meshes.append(part)
    for x in [-0.75, 0.75]:
        part = box([0.12, 1.60, 0.16], GOLD)
        part.apply_translation([x, 0, 0])
        meshes.append(part)
    pearl = sphere(PEARL, 0.38)
    meshes.append(pearl)
    export('YC4413E_1', meshes)


if __name__ == '__main__':
    yc4413e_1()
    yc3536e_1()
    yc5295e_1()
    yc9561e()
    yc8320e_1()
    eh4520()
