"use strict";

window.CharacterRenderer = (() => {
  const skinColors = {
    "skin-light": "#f5cfa9",
    "skin-tan": "#d99a6c",
    "skin-brown": "#9a6246",
    "skin-dark": "#5f392d"
  };

  function drawEffect(ctx, cosmetics, time) {
    const effect = cosmetics.effect;
    if (effect === "effect-none") return;

    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(time * 0.006) * 0.15;

    if (effect === "effect-aura") {
      ctx.strokeStyle = cosmetics.primary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 13, 27, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (effect === "effect-stars" || effect === "effect-numbers") {
      ctx.fillStyle = cosmetics.secondary;
      ctx.font = "bold 10px sans-serif";

      for (let index = 0; index < 4; index += 1) {
        const angle = time * 0.0015 + index * (Math.PI / 2);
        const x = Math.cos(angle) * 27;
        const y = Math.sin(angle) * 15 - 12;
        ctx.fillText(effect === "effect-stars" ? "★" : String(index + 1), x, y);
      }
    }

    ctx.restore();
  }

  function drawBack(ctx, cosmetics) {
    if (cosmetics.back === "back-cape") {
      ctx.fillStyle = cosmetics.secondary;
      ctx.beginPath();
      ctx.moveTo(-13, -12);
      ctx.lineTo(13, -12);
      ctx.lineTo(18, 24);
      ctx.lineTo(-18, 24);
      ctx.closePath();
      ctx.fill();
    }

    if (cosmetics.back === "back-bag") {
      ctx.fillStyle = "#78350f";
      ctx.fillRect(-15, -8, 30, 28);
    }

    if (cosmetics.back === "back-book") {
      ctx.fillStyle = "#7c3aed";
      ctx.fillRect(-15, -8, 30, 24);
      ctx.strokeStyle = "#fde68a";
      ctx.strokeRect(-15, -8, 30, 24);
    }
  }

  function drawClassItem(ctx, classId, secondary) {
    ctx.save();
    ctx.strokeStyle = secondary;
    ctx.fillStyle = secondary;
    ctx.lineWidth = 4;

    if (classId === "warrior") {
      ctx.beginPath();
      ctx.moveTo(19, -6);
      ctx.lineTo(26, 23);
      ctx.stroke();
    } else if (classId === "mage") {
      ctx.beginPath();
      ctx.moveTo(20, -8);
      ctx.lineTo(22, 25);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(19, -12, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (classId === "engineer") {
      ctx.fillStyle = "#ca8a04";
      ctx.fillRect(15, -2, 12, 22);
    } else if (classId === "mathematician") {
      ctx.font = "bold 16px serif";
      ctx.fillText("π", 17, 10);
    }

    ctx.restore();
  }

  function drawHat(ctx, cosmetics) {
    ctx.fillStyle = cosmetics.primary;

    if (cosmetics.hat === "hat-cap") {
      ctx.fillRect(-14, -32, 28, 8);
      ctx.fillRect(7, -27, 14, 4);
    }

    if (cosmetics.hat === "hat-crown") {
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.moveTo(-14, -28);
      ctx.lineTo(-11, -40);
      ctx.lineTo(-4, -32);
      ctx.lineTo(2, -42);
      ctx.lineTo(8, -32);
      ctx.lineTo(14, -40);
      ctx.lineTo(14, -27);
      ctx.closePath();
      ctx.fill();
    }

    if (cosmetics.hat === "hat-wizard") {
      ctx.fillStyle = "#6d28d9";
      ctx.beginPath();
      ctx.moveTo(-18, -26);
      ctx.lineTo(2, -55);
      ctx.lineTo(15, -26);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-22, -28, 42, 7);
    }

    if (cosmetics.hat === "hat-helmet") {
      ctx.fillStyle = "#64748b";
      ctx.beginPath();
      ctx.arc(0, -25, 16, Math.PI, Math.PI * 2);
      ctx.lineTo(16, -19);
      ctx.lineTo(-16, -19);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawGlasses(ctx, cosmetics) {
    if (cosmetics.glasses === "glasses-none") return;

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;

    if (cosmetics.glasses === "glasses-round") {
      ctx.beginPath();
      ctx.arc(-6, -19, 5, 0, Math.PI * 2);
      ctx.arc(6, -19, 5, 0, Math.PI * 2);
      ctx.moveTo(-1, -19);
      ctx.lineTo(1, -19);
      ctx.stroke();
    } else {
      ctx.strokeRect(-12, -24, 10, 9);
      ctx.strokeRect(2, -24, 10, 9);
      ctx.beginPath();
      ctx.moveTo(-2, -20);
      ctx.lineTo(2, -20);
      ctx.stroke();
    }
  }

  function drawHair(ctx, cosmetics) {
    if (cosmetics.hair === "hair-none") return;

    ctx.fillStyle = cosmetics.hairColor;

    if (cosmetics.hair === "hair-short") {
      ctx.beginPath();
      ctx.arc(0, -28, 15, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    if (cosmetics.hair === "hair-long") {
      ctx.beginPath();
      ctx.arc(0, -27, 16, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-16, -28, 7, 24);
      ctx.fillRect(9, -28, 7, 24);
    }

    if (cosmetics.hair === "hair-spiky") {
      ctx.beginPath();
      ctx.moveTo(-15, -25);
      ctx.lineTo(-13, -40);
      ctx.lineTo(-5, -32);
      ctx.lineTo(0, -43);
      ctx.lineTo(6, -32);
      ctx.lineTo(14, -39);
      ctx.lineTo(15, -24);
      ctx.closePath();
      ctx.fill();
    }

    if (cosmetics.hair === "hair-curly") {
      for (let index = -2; index <= 2; index += 1) {
        ctx.beginPath();
        ctx.arc(index * 6, -31 + Math.abs(index) * 2, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCharacter(ctx, options) {
    const {
      x = 0,
      y = 0,
      scale = 1,
      direction = "down",
      moving = false,
      classId = "warrior",
      teamColor = "#3b82f6",
      cosmetics,
      time = performance.now(),
      alpha = 1
    } = options;

    const walk = moving ? Math.sin(time * 0.012) * 6 : 0;
    const skin = skinColors[cosmetics.skin] || skinColors["skin-light"];
    const facingScale = direction === "left" ? -1 : 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * facingScale, scale);
    ctx.globalAlpha = alpha;

    drawEffect(ctx, cosmetics, time);

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 26, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    drawBack(ctx, cosmetics);

    ctx.strokeStyle = cosmetics.pants === "pants-robe" ? cosmetics.secondary : "#1e293b";
    ctx.lineWidth = cosmetics.pants === "pants-robe" ? 12 : 8;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(-7, 14);
    ctx.lineTo(-8 + walk, 30);
    ctx.moveTo(7, 14);
    ctx.lineTo(8 - walk, 30);
    ctx.stroke();

    ctx.strokeStyle =
      cosmetics.shoes === "shoes-runner"
        ? "#38bdf8"
        : cosmetics.shoes === "shoes-boots"
          ? "#3f2a1e"
          : "#111827";

    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-8 + walk, 30);
    ctx.lineTo(-3 + walk, 31);
    ctx.moveTo(8 - walk, 30);
    ctx.lineTo(13 - walk, 31);
    ctx.stroke();

    ctx.fillStyle = cosmetics.primary;
    ctx.fillRect(-14, -10, 28, 29);

    if (cosmetics.shirt === "shirt-armor" || classId === "warrior") {
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(-13, -8, 26, 17);
    }

    if (cosmetics.shirt === "shirt-robe" || classId === "mage") {
      ctx.fillStyle = cosmetics.primary;
      ctx.beginPath();
      ctx.moveTo(-14, 5);
      ctx.lineTo(14, 5);
      ctx.lineTo(19, 23);
      ctx.lineTo(-19, 23);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = teamColor;
    ctx.fillRect(-15, 4, 30, 5);

    ctx.strokeStyle = skin;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-12, -5);
    ctx.lineTo(-19, 10 + walk * 0.45);
    ctx.moveTo(12, -5);
    ctx.lineTo(19, 10 - walk * 0.45);
    ctx.stroke();

    drawClassItem(ctx, classId, cosmetics.secondary);

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -20, 15, 0, Math.PI * 2);
    ctx.fill();

    if (direction !== "up") {
      ctx.fillStyle = cosmetics.eyes;
      ctx.beginPath();
      ctx.arc(-5, -20, 1.8, 0, Math.PI * 2);
      ctx.arc(5, -20, 1.8, 0, Math.PI * 2);
      ctx.fill();

      if (cosmetics.face === "face-happy") {
        ctx.strokeStyle = "#7f1d1d";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, -17, 5, 0.15, Math.PI - 0.15);
        ctx.stroke();
      } else if (cosmetics.face === "face-serious") {
        ctx.strokeStyle = "#7f1d1d";
        ctx.beginPath();
        ctx.moveTo(-4, -14);
        ctx.lineTo(4, -14);
        ctx.stroke();
      }
    }

    drawHair(ctx, cosmetics);
    drawGlasses(ctx, cosmetics);
    drawHat(ctx, cosmetics);

    ctx.restore();
  }

  return { drawCharacter };
})();
