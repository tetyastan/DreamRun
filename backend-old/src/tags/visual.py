import os
import re
from fastapi import HTTPException
from src.tags.base import BaseTag, TagParseResult
from src.config import ASSETS_DIR

class ImageTag(BaseTag):
    """
    Handles multi-layered visual tracking frames with strict asset existence checks.
    """
    name = "image"

    SHOW_PATTERN = re.compile(
        r'^\[image\s+show\s+(?:"(?P<img_path>[^"]+)"|(?P<img_path_var>\{[A-Za-z0-9_\.]+\}))\s+(?P<id>[A-Za-z0-9_\{\}\.]+)\s+(?P<layer>[A-Za-z0-9_\{\}]+)\s+(?:"(?P<c_css>[^"]*)"|(?P<c_css_var>\{[A-Za-z0-9_\.]+\}))\s+(?:"(?P<i_css>[^"]*)"|(?P<i_css_var>\{[A-Za-z0-9_\.]+\}))/\]$'
    )
    MODIFY_PATTERN = re.compile(
        r'^\[image\s+modify\s+(?:"(?P<img_path>[^"]*)"|(?P<img_path_var>\{[A-Za-z0-9_\.]+\}))\s+(?P<id>[A-Za-z0-9_\{\}\.]+)\s+(?P<layer>[A-Za-z0-9_\{\}]+)\s+(?:"(?P<c_css>[^"]*)"|(?P<c_css_var>\{[A-Za-z0-9_\.]+\}))\s+(?:"(?P<i_css>[^"]*)"|(?P<i_css_var>\{[A-Za-z0-9_\.]+\}))/\]$'
    )
    HIDE_PATTERN = re.compile(
        r'^\[image\s+hide\s+(?P<id>[A-Za-z0-9_\{\}\.]+)/\]$'
    )

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.SHOW_PATTERN.match(line)
        if m:
            img_path = m.group("img_path") if m.group("img_path") is not None else m.group("img_path_var")
            container_css = m.group("c_css") if m.group("c_css") is not None else m.group("c_css_var")
            image_css = m.group("i_css") if m.group("i_css") is not None else m.group("i_css_var")
            
            step = {
                "type": "image",
                "modifier": "show",
                "img_path": img_path.strip(),
                "id": m.group("id").strip(),
                "layer": m.group("layer").strip(),
                "container_css": container_css.strip(),
                "image_css": image_css.strip()
            }
            return TagParseResult(step=step, consumed=True)

        m = self.MODIFY_PATTERN.match(line)
        if m:
            img_path = m.group("img_path") if m.group("img_path") is not None else m.group("img_path_var")
            container_css = m.group("c_css") if m.group("c_css") is not None else m.group("c_css_var")
            image_css = m.group("i_css") if m.group("i_css") is not None else m.group("i_css_var")

            step = {
                "type": "image",
                "modifier": "modify",
                "img_path": img_path.strip() if img_path else "",
                "id": m.group("id").strip(),
                "layer": m.group("layer").strip(),
                "container_css": container_css.strip(),
                "image_css": image_css.strip()
            }
            return TagParseResult(step=step, consumed=True)

        m = self.HIDE_PATTERN.match(line)
        if m:
            step = {
                "type": "image",
                "modifier": "hide",
                "id": m.group("id").strip()
            }
            return TagParseResult(step=step, consumed=True)

        return TagParseResult(consumed=False)

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "image":
            return None
        
        session = ctx["session"]
        command = {
            "modifier": step["modifier"],
            "id": step["id"]
        }

        if step["modifier"] in ("show", "modify"):
            if step.get("img_path"):
                path = step["img_path"]
                # Strict check for local source image files
                if path.startswith("/") and not path.startswith("/assets"):
                    relative_img = path.lstrip("/")
                    absolute_img_path = os.path.join(ASSETS_DIR, relative_img)
                    
                    if not os.path.exists(absolute_img_path):
                        raise HTTPException(
                            status_code=422,
                            detail={
                                "status": "IMAGE_ASSET_MISSING_ERROR",
                                "message": f"Required graphic texture file not found on backend server: {path}",
                                "details": f"Expected absolute target: {absolute_img_path}"
                            }
                        )
                    path = f"/assets{path}"
                command["img_path"] = path

            try:
                command["layer"] = int(step["layer"])
            except (ValueError, TypeError):
                command["layer"] = 10

            for css_key in ("container_css", "image_css"):
                css_path = step.get(css_key)
                if css_path and css_path != "none" and css_path != "":
                    relative_path = css_path.replace("/assets/", "") if css_path.startswith("/assets/") else css_path.lstrip("/")
                    absolute_css_path = os.path.join(ASSETS_DIR, relative_path)
                    
                    if not os.path.exists(absolute_css_path):
                        raise HTTPException(
                            status_code=422,
                            detail={
                                "status": "VISUAL_ASSET_MISSING_ERROR",
                                "message": f"Required CSS stylesheet asset not found on backend disk: {css_path}"
                            }
                        )
                    if css_path.startswith("/"):
                        css_path = f"/assets{css_path}"
                    command[css_key] = css_path
                else:
                    command[css_key] = None

        session.setdefault("_pending_images", []).append(command)
        return None
