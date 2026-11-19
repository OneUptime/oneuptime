package com.oneuptime.androidagent.play

import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/*
 * The agent's Google Play store listing, in src/main/play, where Gradle Play
 * Publisher reads it (RELEASING.md, "Google Play"). Every release uploads it
 * with the bundle, so a listing Play would refuse - a title over 30
 * characters, a feature graphic with an alpha channel, a file the plugin
 * does not know - fails here, on the pull request, rather than in a release.
 * The limits are the Play Console's ("Add preview assets", "store listing").
 */
class PlayListingTest {
    private val play = File(System.getProperty("playDir") ?: "src/main/play")
    private val manifest = File(play.parentFile, "AndroidManifest.xml")

    // What Gradle Play Publisher reads; it stops the release at any other file.
    private val globalFiles = setOf("contact-email.txt", "contact-phone.txt", "contact-website.txt", "default-language.txt")
    private val globalDirectories = setOf("listings", "release-notes", "release-names", "products", "subscriptions")
    private val listingFiles = setOf("title.txt", "short-description.txt", "full-description.txt", "video-url.txt")
    private val graphicTypes =
        setOf(
            "icon", "feature-graphic", "phone-screenshots", "tablet-screenshots", "large-tablet-screenshots",
            "tv-banner", "tv-screenshots", "wear-screenshots",
        )

    // As the plugin reads a text file: line breaks normalised, trimmed.
    private fun text(file: File): String = file.readText().replace("\r\n", "\n").trim()

    private fun length(text: String): Int = text.codePointCount(0, text.length)

    private fun listings(): List<File> {
        val locales = File(play, "listings").listFiles { file -> file.isDirectory }.orEmpty().sortedBy { it.name }
        assertTrue("There is no listing in $play/listings", locales.isNotEmpty())
        return locales
    }

    private fun graphics(locale: File, type: String): List<File> =
        File(locale, "graphics/$type").listFiles { file -> file.isFile }.orEmpty().sortedBy { it.name }

    private fun image(file: File): BufferedImage {
        val image: BufferedImage? = ImageIO.read(file)
        assertTrue("$file is not an image", image != null)
        return image!!
    }

    private fun isPng(file: File): Boolean =
        file.readBytes().take(8) == listOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A).map { it.toByte() }

    @Test
    fun `holds only files Gradle Play Publisher reads`() {
        play.listFiles().orEmpty().forEach { file ->
            val known = if (file.isDirectory) file.name in globalDirectories else file.name in globalFiles
            assertTrue("$file is not a file Gradle Play Publisher reads", known)
        }
        listings().forEach { locale ->
            locale.listFiles().orEmpty().forEach { file ->
                val known = if (file.isDirectory) file.name == "graphics" else file.name in listingFiles
                assertTrue("$file is not a listing file Gradle Play Publisher reads", known)
            }
            File(locale, "graphics").listFiles().orEmpty().forEach { type ->
                assertTrue("$type is not a kind of graphic Google Play takes", type.isDirectory && type.name in graphicTypes)
            }
        }
    }

    @Test
    fun `each listing has a title, a short and a full description, within Google Play's limits`() {
        listings().forEach { locale ->
            val title = text(File(locale, "title.txt"))
            val short = text(File(locale, "short-description.txt"))
            val full = text(File(locale, "full-description.txt"))

            assertTrue("${locale.name}: the title is empty", title.isNotEmpty())
            assertTrue("${locale.name}: the title is ${length(title)} characters, over 30", length(title) <= 30)
            assertTrue("${locale.name}: the short description is empty", short.isNotEmpty())
            assertTrue("${locale.name}: the short description is ${length(short)} characters, over 80", length(short) <= 80)
            assertFalse("${locale.name}: the short description is more than one line", short.contains('\n'))
            assertTrue("${locale.name}: the full description is empty", full.isNotEmpty())
            assertTrue("${locale.name}: the full description is ${length(full)} characters, over 4000", length(full) <= 4000)
        }
    }

    @Test
    fun `the release notes fit the 500 characters Google Play takes`() {
        val notes = File(play, "release-notes").walkTopDown().filter { it.isFile }.toList()

        assertTrue("There are no release notes in $play/release-notes", notes.any { it.name == "default.txt" })
        notes.forEach { file ->
            val text = text(file)
            assertTrue("$file is empty", text.isNotEmpty())
            assertTrue("$file is ${length(text)} characters, over 500", length(text) <= 500)
        }
    }

    @Test
    fun `the default language has a listing, and the contact details are an email address and an https site`() {
        val language = text(File(play, "default-language.txt"))

        assertTrue("No listing for the default language $language", File(play, "listings/$language").isDirectory)
        assertTrue(Regex("""^[^@\s]+@[^@\s]+\.[a-z]{2,}$""").matches(text(File(play, "contact-email.txt"))))
        assertTrue(Regex("""^https://\S+$""").matches(text(File(play, "contact-website.txt"))))
    }

    @Test
    fun `the icon is a 512 by 512 PNG of at most 1 MB`() {
        listings().forEach { locale ->
            val icons = graphics(locale, "icon")
            assertEquals("${locale.name}: one icon", 1, icons.size)
            val icon = icons.single()
            val image = image(icon)

            assertTrue("$icon is not a PNG", isPng(icon))
            assertEquals("$icon", 512 to 512, image.width to image.height)
            assertTrue("$icon is over 1 MB", icon.length() <= 1024 * 1024)
        }
    }

    @Test
    fun `the feature graphic is 1024 by 500, with no alpha channel`() {
        listings().forEach { locale ->
            val graphics = graphics(locale, "feature-graphic")
            assertEquals("${locale.name}: one feature graphic", 1, graphics.size)
            val graphic = graphics.single()
            val image = image(graphic)

            assertEquals("$graphic", 1024 to 500, image.width to image.height)
            assertFalse("$graphic has an alpha channel, which Google Play refuses", image.colorModel.hasAlpha())
        }
    }

    /*
     * None yet (RELEASING.md lists what a public listing still needs). Any
     * added must be two to eight of a kind, 320 to 3840 pixels a side (7680
     * for tablets), the longer at most 2.3 times the shorter, with no alpha
     * channel.
     */
    @Test
    fun `screenshots, where there are any, are ones Google Play takes`() {
        listings().forEach { locale ->
            graphicTypes.filter { it.endsWith("screenshots") }.forEach { type ->
                val shots = graphics(locale, type)
                val largest = if (type.contains("tablet")) 7680 else 3840
                if (shots.isNotEmpty()) {
                    assertTrue("${locale.name}/$type: ${shots.size} screenshots, not 2 to 8", shots.size in 2..8)
                }
                shots.forEach { shot ->
                    val image = image(shot)
                    val longer = maxOf(image.width, image.height)
                    val shorter = minOf(image.width, image.height)
                    assertTrue("$shot is ${image.width} x ${image.height}", shorter >= 320 && longer <= largest)
                    assertTrue("$shot is longer than 2.3 times its width", longer <= shorter * 2.3)
                    assertFalse("$shot has an alpha channel", image.colorModel.hasAlpha())
                }
            }
        }
    }

    /*
     * Google Play lets an app see every installed app (QUERY_ALL_PACKAGES)
     * only when that is a core purpose of it, prominently described in its
     * listing: the agent's is the device's inventory of installed apps.
     */
    @Test
    fun `the description says why the agent sees every installed app`() {
        val permissions = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest)
            .getElementsByTagName("uses-permission")
        val declared = (0 until permissions.length).map {
            (permissions.item(it) as Element).getAttributeNS("http://schemas.android.com/apk/res/android", "name")
        }

        assertTrue(declared.contains("android.permission.QUERY_ALL_PACKAGES"))
        listings().forEach { locale ->
            val full = text(File(locale, "full-description.txt"))
            assertTrue("${locale.name}: the full description does not mention installed apps", full.contains("installed app", ignoreCase = true))
        }
    }
}
