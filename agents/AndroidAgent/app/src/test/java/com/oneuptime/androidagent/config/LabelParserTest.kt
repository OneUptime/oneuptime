package com.oneuptime.androidagent.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LabelParserTest {
    @Test
    fun `pairs are read with either separator, in their order`() {
        val result: LabelParser.Result = LabelParser.parse("store=0412, region:emea;\n floor = 2 ")

        assertEquals(linkedMapOf("store" to "0412", "region" to "emea", "floor" to "2"), result.labels)
        assertEquals(listOf("store", "region", "floor"), result.labels.keys.toList())
        assertTrue(result.rejected.isEmpty())
    }

    @Test
    fun `a value keeps what follows its first separator`() {
        assertEquals(mapOf("url" to "https://pos.example.com"), LabelParser.parse("url=https://pos.example.com").labels)
    }

    @Test
    fun `pairs that cannot be labels are left out and reported`() {
        val result: LabelParser.Result = LabelParser.parse("store=0412, no separator, =value, name=, bad name=1, ok.name-1_x=yes")

        assertEquals(mapOf("store" to "0412", "ok.name-1_x" to "yes"), result.labels)
        assertEquals(listOf("no separator", "=value", "name=", "bad name=1"), result.rejected)
    }

    @Test
    fun `nothing gives no labels`() {
        assertTrue(LabelParser.parse(null).labels.isEmpty())
        assertTrue(LabelParser.parse(" , ;").labels.isEmpty())
    }

    @Test
    fun `there are at most twenty, and a long value is cut`() {
        val many: String = (1..25).joinToString(",") { "k$it=v$it" }
        val result: LabelParser.Result = LabelParser.parse(many)

        assertEquals(LabelParser.MAX_LABELS, result.labels.size)
        assertEquals(5, result.rejected.size)
        assertEquals(100, LabelParser.parse("long=" + "x".repeat(300)).labels.getValue("long").length)
    }
}
