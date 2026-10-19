"""Optional vector brand asset generator. Requires fonttools; not needed to run the site."""
from pathlib import Path
import base64
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/brand';OUT.mkdir(parents=True,exist_ok=True)
font=TTFont(ROOT/'public/assets/680e72729f546840cd17798a_FeatureHeadline-Upright-VF_wght_wdth_opsz.ttf')
font=instantiateVariableFont(font,{'wght':600},inplace=False)
glyphs=font.getGlyphSet();cmap=font.getBestCmap();upm=font['head'].unitsPerEm
def wordmark(text,size,x,y,color):
    paths=[];cursor=0
    for c in text:
        name=cmap[ord(c)];pen=SVGPathPen(glyphs);glyphs[name].draw(pen)
        paths.append(f'<path transform="translate({cursor} 0)" d="{pen.getCommands()}"/>')
        cursor+=font['hmtx'][name][0]-upm*.025
    return f'<g fill="{color}" transform="translate({x} {y}) scale({size/upm} {-size/upm})">'+''.join(paths)+'</g>'
logo='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 125" role="img" aria-label="Gigwork">'+wordmark('gigwork',112,8,94,'#fa4028')+'</svg>'
(OUT/'gigwork-wordmark.svg').write_text(logo)
(OUT/'favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#00063d"/>'+wordmark('g',61,15,43,'#e6ffd4')+'</svg>')
owl=base64.b64encode((ROOT/'public/assets/mascots/gigwork-owl.png').read_bytes()).decode()
banner='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600" role="img" aria-label="Gigwork: Do the work. Keep the possibilities."><defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#00063d" stroke-opacity=".11"/></pattern></defs><rect width="1600" height="600" fill="#f2f2f2"/><path d="M850 600V180H970V70H1300V180H1420V280H1600V600Z" fill="#e6ffd4"/><path d="M850 600V180H970V70H1300V180H1420V280H1600V600Z" fill="url(#grid)"/><circle cx="1450" cy="180" r="95" fill="#ceebff"/><rect x="940" y="250" width="190" height="270" fill="#ffe6f3" transform="rotate(-12 940 250)"/>'+wordmark('gigwork',105,90,160,'#fa4028')+'<text x="90" y="270" font-family="Arial,sans-serif" font-size="51" fill="#00063d" letter-spacing="-2">Do the work.</text><text x="90" y="334" font-family="Arial,sans-serif" font-size="51" fill="#00063d" letter-spacing="-2">Keep the possibilities.</text><text x="93" y="415" font-family="Arial,sans-serif" font-size="22" fill="#00063d">Quick tasks. Freelance gigs. Ongoing contracts.</text><image x="900" y="30" width="620" height="620" href="data:image/png;base64,'+owl+'"/><rect x="1220" y="430" width="255" height="80" fill="#00063d"/><text x="1245" y="463" font-family="Arial,sans-serif" font-size="16" fill="#e6ffd4">FUNDED BEFORE</text><text x="1245" y="488" font-family="Arial,sans-serif" font-size="16" fill="#e6ffd4">THE WORK STARTS.</text></svg>'
(OUT/'gigwork-banner.svg').write_text(banner)
print('Created 3 native SVG brand assets.')
