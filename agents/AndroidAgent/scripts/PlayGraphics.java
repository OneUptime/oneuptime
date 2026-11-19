/*
 * Draws the Google Play listing's two required graphics from the app's own
 * launcher icon, into app/src/main/play/listings/en-US/graphics, where Gradle
 * Play Publisher reads them (RELEASING.md, "Google Play"):
 *
 *   icon/1.png             512 x 512: the launcher icon as a device shows it,
 *                          OneUptime's logo on white, full bleed (Google Play
 *                          rounds the corners itself)
 *   feature-graphic/1.png  1024 x 500, with no alpha channel, as Google Play
 *                          requires: the icon and the agent's name on
 *                          OneUptime's indigo, kept to the middle, which no
 *                          placement crops
 *
 * Run it from agents/AndroidAgent after the logo or its colors change, and
 * commit both files:
 *
 *   java scripts/PlayGraphics.java
 *
 * It reads res/drawable/ic_launcher_foreground.xml and res/values/colors.xml,
 * and needs nothing but a JDK. The text is set in Liberation Sans where it is
 * installed, and in the JDK's sans-serif font where it is not.
 */

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.GraphicsEnvironment;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.geom.Path2D;
import java.awt.geom.Point2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

public class PlayGraphics {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";
    private static final String RES = "app/src/main/res";
    private static final String GRAPHICS = "app/src/main/play/listings/en-US/graphics";

    private static final String TITLE = "OneUptime Android Agent";
    private static final String SUBTITLE = "Monitoring for managed Android devices";

    // OneUptime's indigo (the setup screen's accent, res/values/colors.xml), darker to lighter.
    private static final Color INDIGO_DARK = new Color(0x43, 0x38, 0xCA);
    private static final Color INDIGO_LIGHT = new Color(0x63, 0x66, 0xF1);
    private static final Color SUBTITLE_COLOR = new Color(0xE0, 0xE7, 0xFF);

    /** A filled path of the vector, in its viewport's units, with its color. */
    private record Shape(Path2D path, Color color) {}

    public static void main(String[] args) throws Exception {
        System.setProperty("java.awt.headless", "true");

        Map<String, Color> colors = readColors(new File(RES, "values/colors.xml"));
        List<Shape> logo = readVector(new File(RES, "drawable/ic_launcher_foreground.xml"), colors);
        Color background = colors.get("launcher_background");

        write(icon(logo, background), new File(GRAPHICS, "icon/1.png"));
        write(featureGraphic(logo, background), new File(GRAPHICS, "feature-graphic/1.png"));
    }

    /** 512 x 512, full bleed: the logo, centered, takes 58% of the width, a little more than on a launcher. */
    static BufferedImage icon(List<Shape> logo, Color background) {
        int size = 512;
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = graphics(image);
        g.setColor(background);
        g.fillRect(0, 0, size, size);
        drawCentered(g, logo, size / 2.0, size / 2.0, size * 0.58);
        g.dispose();
        return image;
    }

    /*
     * 1024 x 500 and opaque (TYPE_INT_RGB writes a PNG with no alpha): the
     * icon as a rounded tile, the agent's name and one line on what it is,
     * stacked in the middle third, on an indigo gradient, which is neither
     * white, black nor dark gray, the backgrounds Google Play asks to avoid.
     */
    static BufferedImage featureGraphic(List<Shape> logo, Color tile) {
        int width = 1024;
        int height = 500;
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = graphics(image);
        g.setPaint(new GradientPaint(0, 0, INDIGO_DARK, width, height, INDIGO_LIGHT));
        g.fillRect(0, 0, width, height);

        double tileSize = 148;
        double tileX = (width - tileSize) / 2;
        double tileY = 72;
        RoundRectangle2D.Double tileShape = new RoundRectangle2D.Double(tileX, tileY, tileSize, tileSize, 64, 64);
        // A soft shadow under the tile: three widening, fading outlines.
        for (int ring = 3; ring >= 1; ring--) {
            g.setColor(new Color(0x1E, 0x1B, 0x4B, 22 * (4 - ring)));
            g.setStroke(new BasicStroke(ring * 6f));
            g.draw(new RoundRectangle2D.Double(tileX, tileY + 6, tileSize, tileSize, 64, 64));
        }
        g.setColor(tile);
        g.fill(tileShape);
        drawCentered(g, logo, width / 2.0, tileY + tileSize / 2, tileSize * 0.62);

        String family = fontFamily();
        g.setColor(Color.WHITE);
        drawCenteredText(g, TITLE, new Font(family, Font.BOLD, 58), width / 2.0, 318);
        g.setColor(SUBTITLE_COLOR);
        drawCenteredText(g, SUBTITLE, new Font(family, Font.PLAIN, 30), width / 2.0, 372);
        g.dispose();
        return image;
    }

    private static Graphics2D graphics(BufferedImage image) {
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        return g;
    }

    /** Draws the logo so the ink of its paths is `width` wide and centered on (centerX, centerY). */
    private static void drawCentered(Graphics2D g, List<Shape> logo, double centerX, double centerY, double width) {
        Rectangle2D bounds = null;
        for (Shape shape : logo) {
            bounds = bounds == null ? shape.path().getBounds2D() : bounds.createUnion(shape.path().getBounds2D());
        }
        double scale = width / bounds.getWidth();
        AffineTransform transform = new AffineTransform();
        transform.translate(centerX - bounds.getCenterX() * scale, centerY - bounds.getCenterY() * scale);
        transform.scale(scale, scale);
        for (Shape shape : logo) {
            g.setColor(shape.color());
            g.fill(transform.createTransformedShape(shape.path()));
        }
    }

    /** Draws one line of text centered on centerX, with its baseline at y. */
    private static void drawCenteredText(Graphics2D g, String text, Font font, double centerX, double y) {
        g.setFont(font);
        FontMetrics metrics = g.getFontMetrics();
        double width = metrics.getStringBounds(text, g).getWidth();
        g.drawString(text, (float) (centerX - width / 2), (float) y);
    }

    private static String fontFamily() {
        List<String> installed = Arrays.asList(GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames());
        return installed.contains("Liberation Sans") ? "Liberation Sans" : Font.SANS_SERIF;
    }

    private static void write(BufferedImage image, File file) throws Exception {
        file.getParentFile().mkdirs();
        if (!ImageIO.write(image, "png", file)) {
            throw new IllegalStateException("No PNG writer for " + file);
        }
        System.out.println("Wrote " + file + " (" + image.getWidth() + " x " + image.getHeight() + ")");
    }

    // ---- The vector drawable: <color> resources, and a <vector>'s groups and paths ----

    private static Document parse(File file) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder().parse(file);
    }

    private static Map<String, Color> readColors(File file) throws Exception {
        Map<String, Color> colors = new HashMap<>();
        var nodes = parse(file).getElementsByTagName("color");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element color = (Element) nodes.item(i);
            colors.put(color.getAttribute("name"), parseColor(color.getTextContent().trim()));
        }
        return colors;
    }

    /** #RGB, #RRGGBB or #AARRGGBB, as Android writes colors. */
    private static Color parseColor(String value) {
        String hex = value.substring(1);
        if (hex.length() == 3) {
            hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        }
        long argb = Long.parseLong(hex.length() == 6 ? "FF" + hex : hex, 16);
        return new Color((int) argb, true);
    }

    private static List<Shape> readVector(File file, Map<String, Color> colors) throws Exception {
        List<Shape> shapes = new ArrayList<>();
        collect(parse(file).getDocumentElement(), new AffineTransform(), colors, shapes);
        if (shapes.isEmpty()) {
            throw new IllegalStateException(file + " has no path");
        }
        return shapes;
    }

    private static void collect(Element element, AffineTransform parent, Map<String, Color> colors, List<Shape> shapes) {
        for (Node node = element.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (!(node instanceof Element child)) {
                continue;
            }
            if (child.getLocalName().equals("group")) {
                collect(child, groupTransform(parent, child), colors, shapes);
            } else if (child.getLocalName().equals("path")) {
                Path2D path = PathData.parse(child.getAttributeNS(ANDROID, "pathData"));
                path.transform(parent);
                shapes.add(new Shape(path, fill(child, colors)));
            }
        }
    }

    // A group's transform, as VectorDrawable applies it: scale and rotate about the pivot, then translate.
    private static AffineTransform groupTransform(AffineTransform parent, Element group) {
        double pivotX = number(group, "pivotX", 0);
        double pivotY = number(group, "pivotY", 0);
        AffineTransform transform = new AffineTransform(parent);
        transform.translate(pivotX + number(group, "translateX", 0), pivotY + number(group, "translateY", 0));
        transform.rotate(Math.toRadians(number(group, "rotation", 0)));
        transform.scale(number(group, "scaleX", 1), number(group, "scaleY", 1));
        transform.translate(-pivotX, -pivotY);
        return transform;
    }

    private static Color fill(Element path, Map<String, Color> colors) {
        String value = path.getAttributeNS(ANDROID, "fillColor");
        Color color = value.startsWith("@color/") ? colors.get(value.substring("@color/".length())) : parseColor(value);
        if (color == null) {
            throw new IllegalStateException("No color " + value);
        }
        int alpha = (int) Math.round(color.getAlpha() * number(path, "fillAlpha", 1));
        return new Color(color.getRed(), color.getGreen(), color.getBlue(), alpha);
    }

    private static double number(Element element, String attribute, double fallback) {
        String value = element.getAttributeNS(ANDROID, attribute);
        return value.isEmpty() ? fallback : Double.parseDouble(value);
    }

    /** SVG path data, as android:pathData writes it: moves, lines and Bézier curves (no arcs). */
    static final class PathData {
        private final String data;
        private int index;

        private PathData(String data) {
            this.data = data;
        }

        static Path2D parse(String data) {
            return new PathData(data).read();
        }

        private Path2D read() {
            Path2D.Double path = new Path2D.Double(Path2D.WIND_NON_ZERO);
            char command = ' ';
            Point2D.Double current = new Point2D.Double();
            Point2D.Double start = new Point2D.Double();
            Point2D.Double control = null;
            char previous = ' ';
            while (true) {
                skipSeparators();
                if (index >= data.length()) {
                    return path;
                }
                char next = data.charAt(index);
                if (Character.isLetter(next)) {
                    command = next;
                    index++;
                } else if (command == ' ') {
                    throw new IllegalArgumentException("Path data starts with a number: " + data);
                }
                boolean relative = Character.isLowerCase(command);
                double dx = relative ? current.x : 0;
                double dy = relative ? current.y : 0;
                switch (Character.toUpperCase(command)) {
                    case 'M' -> {
                        current.setLocation(dx + number(), dy + number());
                        path.moveTo(current.x, current.y);
                        start.setLocation(current);
                        // Further pairs after a move are lines.
                        command = relative ? 'l' : 'L';
                    }
                    case 'L' -> {
                        current.setLocation(dx + number(), dy + number());
                        path.lineTo(current.x, current.y);
                    }
                    case 'H' -> {
                        current.x = dx + number();
                        path.lineTo(current.x, current.y);
                    }
                    case 'V' -> {
                        current.y = dy + number();
                        path.lineTo(current.x, current.y);
                    }
                    case 'C' -> {
                        double x1 = dx + number(), y1 = dy + number();
                        double x2 = dx + number(), y2 = dy + number();
                        current.setLocation(dx + number(), dy + number());
                        path.curveTo(x1, y1, x2, y2, current.x, current.y);
                        control = new Point2D.Double(x2, y2);
                    }
                    case 'S' -> {
                        Point2D.Double first = reflect(control, current, previous, "CS");
                        double x2 = dx + number(), y2 = dy + number();
                        current.setLocation(dx + number(), dy + number());
                        path.curveTo(first.x, first.y, x2, y2, current.x, current.y);
                        control = new Point2D.Double(x2, y2);
                    }
                    case 'Q' -> {
                        double x1 = dx + number(), y1 = dy + number();
                        current.setLocation(dx + number(), dy + number());
                        path.quadTo(x1, y1, current.x, current.y);
                        control = new Point2D.Double(x1, y1);
                    }
                    case 'T' -> {
                        Point2D.Double first = reflect(control, current, previous, "QT");
                        current.setLocation(dx + number(), dy + number());
                        path.quadTo(first.x, first.y, current.x, current.y);
                        control = first;
                    }
                    case 'Z' -> {
                        path.closePath();
                        current.setLocation(start);
                    }
                    default -> throw new IllegalArgumentException("Unsupported path command " + command + " in " + data);
                }
                previous = Character.toUpperCase(command);
            }
        }

        // The control point a smooth curve mirrors: the last one, if the last segment was a curve of the same kind.
        private static Point2D.Double reflect(Point2D.Double control, Point2D.Double current, char previous, String kinds) {
            if (control == null || kinds.indexOf(previous) < 0) {
                return new Point2D.Double(current.x, current.y);
            }
            return new Point2D.Double(2 * current.x - control.x, 2 * current.y - control.y);
        }

        private void skipSeparators() {
            while (index < data.length() && (Character.isWhitespace(data.charAt(index)) || data.charAt(index) == ',')) {
                index++;
            }
        }

        private double number() {
            skipSeparators();
            int begin = index;
            if (index < data.length() && (data.charAt(index) == '-' || data.charAt(index) == '+')) {
                index++;
            }
            boolean dot = false;
            boolean exponent = false;
            while (index < data.length()) {
                char c = data.charAt(index);
                if (Character.isDigit(c)) {
                    index++;
                } else if (c == '.' && !dot && !exponent) {
                    dot = true;
                    index++;
                } else if ((c == 'e' || c == 'E') && !exponent) {
                    exponent = true;
                    index++;
                    if (index < data.length() && (data.charAt(index) == '-' || data.charAt(index) == '+')) {
                        index++;
                    }
                } else {
                    break;
                }
            }
            if (begin == index) {
                throw new IllegalArgumentException("Expected a number at " + begin + " in " + data);
            }
            return Double.parseDouble(data.substring(begin, index));
        }
    }
}
