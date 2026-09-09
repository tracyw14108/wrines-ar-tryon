from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'products' / 'angles'
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 384
ANGLES = {'front':1.0,'left45':0.78,'left90':0.38,'right45':0.78,'right90':0.38}


def rgba(hexstr, a=255):
    h=hexstr.lstrip('#')
    return tuple(int(h[i:i+2],16) for i in (0,2,4))+(a,)


def canvas():
    return Image.new('RGBA',(SIZE,SIZE),(0,0,0,0))


def add_shadow(base, alpha=50, blur=10, offset=(0,6)):
    a=base.getchannel('A')
    sh=Image.new('RGBA',base.size,(0,0,0,0))
    sh.putalpha(a.filter(ImageFilter.GaussianBlur(blur)).point(lambda p:p*alpha//255))
    out=Image.new('RGBA',base.size,(0,0,0,0))
    out.alpha_composite(sh, offset)
    out.alpha_composite(base)
    return out


def pearl(draw, cx, cy, r, dark=False):
    colors=['#222829','#364043','#5e6867','#89918d'] if dark else ['#d8cdbd','#e8ded0','#f7f2ea','#ffffff']
    for i,c in enumerate(colors):
        rr=r*(1-i*0.12)
        ox=-r*0.08*i; oy=-r*0.08*i
        draw.ellipse((cx-rr+ox,cy-rr+oy,cx+rr+ox,cy+rr+oy), fill=rgba(c))
    draw.ellipse((cx-r*0.45,cy-r*0.48,cx-r*0.05,cy-r*0.08), fill=(255,255,255,155))


def rounded_frame(img, gold=True):
    d=ImageDraw.Draw(img)
    c='#c9953d' if gold else '#d8dde2'; c2='#f4d38a' if gold else '#ffffff'
    for w,col in [(32,c),(18,c2),(8,c)]:
        d.rounded_rectangle((82,82,302,302), radius=58, outline=rgba(col), width=w)
    pearl(d,192,192,64,False)


def bow(img, with_pearl=False):
    d=ImageDraw.Draw(img)
    ptsL=[(192,192),(160,152),(106,144),(74,178),(74,210),(102,232),(144,222),(192,192)]
    ptsR=[(192,192),(224,152),(278,144),(310,178),(310,210),(282,232),(240,222),(192,192)]
    for pts in [ptsL,ptsR]:
        d.line(pts, fill=rgba('#dfe4e8'), width=22, joint='curve')
        d.line(pts, fill=rgba('#ffffff'), width=9, joint='curve')
    d.ellipse((172,178,212,206), fill=rgba('#dfe4e8'))
    d.ellipse((179,183,205,201), fill=rgba('#ffffff'))
    if with_pearl: pearl(d,192,112,28,False)


def tassel(img):
    d=ImageDraw.Draw(img)
    d.ellipse((174,50,210,86), fill=rgba('#e4e8eb'))
    d.ellipse((180,56,204,80), fill=rgba('#ffffff'))
    xs=[155,174,192,210,229]; lens=[185,210,235,208,180]
    for j,(x,L) in enumerate(zip(xs,lens)):
        y0=84; x2=x+(j-2)*5
        d.line((x,y0,x2,y0+L), fill=rgba('#d9dee2'), width=8)
        d.line((x+2,y0,x2+2,y0+L), fill=rgba('#ffffff'), width=3)
        d.ellipse((x2-5,y0+L-5,x2+5,y0+L+5), fill=rgba('#e8ecef'))


def pearl_stud(img):
    d=ImageDraw.Draw(img)
    pearl(d,192,192,78,True)
    d.regular_polygon((218,170,16),5,rotation=-90,fill=rgba('#eef1f3'))


def star(img):
    d=ImageDraw.Draw(img); pts=[]
    for i in range(10):
        r=88 if i%2==0 else 38; a=-math.pi/2+i*math.pi/5
        pts.append((192+math.cos(a)*r,192+math.sin(a)*r))
    d.polygon(pts, fill=rgba('#e5e8eb'), outline=rgba('#ffffff'))
    d.line(pts+[pts[0]], fill=rgba('#c5cbd0'), width=5, joint='curve')
    pearl(d,192,192,20,False)


def render_front(sku):
    im=canvas()
    if sku=='YC4413E_1': rounded_frame(im,True)
    elif sku=='YC3536E_1': bow(im,False)
    elif sku=='YC5295E_1': tassel(im)
    elif sku=='YC9561E': pearl_stud(im)
    elif sku=='YC8320E_1': bow(im,True)
    elif sku=='EH-4520': star(im)
    else: raise KeyError(sku)
    return add_shadow(im,42,8,(0,5))


def angle_variant(front, scale_x, side, sku):
    bbox=front.getbbox() or (0,0,SIZE,SIZE)
    crop=front.crop(bbox)
    nw=max(20,int(crop.width*scale_x))
    crop=crop.resize((nw,crop.height),Image.Resampling.LANCZOS)
    out=canvas(); x=(SIZE-nw)//2; y=(SIZE-crop.height)//2
    out.alpha_composite(crop,(x,y))
    if side and sku != 'YC5295E_1':
        d=ImageDraw.Draw(out); ypost=192
        if scale_x <= .4:
            if side=='left': d.line((205,ypost,305,ypost), fill=rgba('#cfd5da'), width=5)
            else: d.line((79,ypost,179,ypost), fill=rgba('#cfd5da'), width=5)
        else:
            if side=='left': d.line((235,ypost,292,ypost), fill=rgba('#d5dade'), width=4)
            else: d.line((92,ypost,149,ypost), fill=rgba('#d5dade'), width=4)
    return out


def main():
    skus=['YC4413E_1','YC3536E_1','YC5295E_1','YC9561E','YC8320E_1','EH-4520']
    for sku in skus:
        front=render_front(sku)
        for key,sx in ANGLES.items():
            side='left' if key.startswith('left') else 'right' if key.startswith('right') else None
            img=front if key=='front' else angle_variant(front,sx,side,sku)
            path=OUT/f'{sku}_{key}.png'
            img.save(path,'PNG',optimize=True)
            print(path.relative_to(ROOT))

if __name__=='__main__': main()
