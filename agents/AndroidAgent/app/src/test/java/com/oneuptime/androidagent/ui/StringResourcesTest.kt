package com.oneuptime.androidagent.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import org.w3c.dom.NodeList
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/*
 * The agent's words - its setup screen, its notifications and the titles and
 * descriptions a device manager shows for its managed settings - in every
 * language OneUptime's Dashboard speaks (#9804). Each translation has every
 * string the English one has, no more, with the same placeholders, so no
 * screen falls back to English halfway down or shows a "%1$s", and the keys
 * and commands people copy are written exactly as in English.
 */
class StringResourcesTest {
    private val res = File(System.getProperty("resDir") ?: "src/main/res")

    // OneUptime's languages (the Dashboard's locales), as Android names their resource folders.
    private val locales: List<String> =
        listOf(
            "ar", "da", "de", "es", "fa", "fr", "hi", "it", "ja", "ko", "nb", "nl", "pt", "ru", "sv", "zh-rCN", "zh-rTW",
        )

    // What people type or copy, as the English writes it: never translated.
    private val verbatim: List<String> =
        listOf("oneuptime_token", "https://oneuptime.com", "\${esper.deviceName}", "\${esper.serialNumber}", "store=0412")

    private class Strings(val strings: Map<String, String>, val plurals: Map<String, Map<String, String>>, val untranslatable: Set<String>)

    private fun read(folder: String): Strings {
        val file = File(res, "$folder/strings.xml")
        assertTrue("$file is missing", file.isFile)
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val strings: MutableMap<String, String> = linkedMapOf()
        val untranslatable: MutableSet<String> = mutableSetOf()
        val stringNodes: NodeList = document.getElementsByTagName("string")
        for (index in 0 until stringNodes.length) {
            val element = stringNodes.item(index) as Element
            val name = element.getAttribute("name")
            assertTrue("$folder: $name appears twice", name !in strings)
            strings[name] = element.textContent
            if (element.getAttribute("translatable") == "false") {
                untranslatable.add(name)
            }
        }
        val plurals: MutableMap<String, Map<String, String>> = linkedMapOf()
        val pluralNodes: NodeList = document.getElementsByTagName("plurals")
        for (index in 0 until pluralNodes.length) {
            val element = pluralNodes.item(index) as Element
            val items: MutableMap<String, String> = linkedMapOf()
            val itemNodes: NodeList = element.getElementsByTagName("item")
            for (itemIndex in 0 until itemNodes.length) {
                val item = itemNodes.item(itemIndex) as Element
                items[item.getAttribute("quantity")] = item.textContent
            }
            plurals[element.getAttribute("name")] = items
        }
        return Strings(strings, plurals, untranslatable)
    }

    // A string's placeholders, %1$s and %d, in a fixed order: a translation may move them, never drop or add one.
    private fun placeholders(text: String): List<String> =
        Regex("%(\\d+\\$)?[-#+ 0,(]*\\d*(\\.\\d+)?[a-zA-Z]").findAll(text).map { it.value }.sorted().toList()

    @Test
    fun `there is a translation for each of OneUptime's languages`() {
        val folders: Set<String> =
            res.listFiles { file -> file.isDirectory && File(file, "strings.xml").isFile }!!.map { it.name }.toSet()

        assertEquals(locales.map { "values-$it" }.toSet() + "values", folders)
    }

    @Test
    fun `each translation has every string the English has, and no other`() {
        val english = read("values")
        val translatable: Set<String> = english.strings.keys - english.untranslatable

        locales.forEach { locale ->
            val translation = read("values-$locale")
            assertEquals("values-$locale", translatable, translation.strings.keys)
            assertEquals("values-$locale", english.plurals.keys, translation.plurals.keys)
            translation.plurals.forEach { (name, items) ->
                assertTrue("values-$locale: $name has no 'other'", "other" in items)
            }
        }
    }

    @Test
    fun `the app's name is OneUptime Agent in every language`() {
        val english = read("values")

        assertTrue("app_name" in english.untranslatable)
        assertEquals("OneUptime Agent", english.strings["app_name"])
    }

    @Test
    fun `each translation keeps every placeholder`() {
        val english = read("values")

        locales.forEach { locale ->
            val translation = read("values-$locale")
            translation.strings.forEach { (name, text) ->
                assertEquals("values-$locale: $name", placeholders(english.strings.getValue(name)), placeholders(text))
            }
            translation.plurals.forEach { (name, items) ->
                assertEquals(
                    "values-$locale: $name",
                    placeholders(english.plurals.getValue(name).getValue("other")),
                    placeholders(items.getValue("other")),
                )
            }
        }
    }

    @Test
    fun `what people type or copy is written exactly as in English`() {
        val english = read("values")

        locales.forEach { locale ->
            val translation = read("values-$locale")
            translation.strings.forEach { (name, text) ->
                verbatim.filter { english.strings.getValue(name).contains(it) }.forEach { token ->
                    assertTrue("values-$locale: $name lost $token", text.contains(token))
                }
            }
        }
    }

    @Test
    fun `no translation is left in English`() {
        val english = read("values")

        locales.forEach { locale ->
            val translation = read("values-$locale")
            // A sentence of three words or more; "%1$s · %2$s" has none.
            val same: List<String> =
                translation.strings.filter { (name, text) ->
                    val words: List<String> =
                        Regex("%(\\d+\\$)?[a-z]").replace(text, " ").split(' ').filter { word -> word.any { it.isLetter() } }
                    text == english.strings[name] && words.size > 2
                }.keys.toList()
            assertEquals("values-$locale has strings still in English", emptyList<String>(), same)
        }
    }
}
