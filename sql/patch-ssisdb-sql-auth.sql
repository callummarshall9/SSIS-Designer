-- ============================================================================
-- Patch SSISDB catalog stored procedures to allow SQL Server Authentication
-- ============================================================================
-- By default, SSISDB catalog SPs reject SQL Auth logins (error 27123).
-- This script removes that check so you can use them from Linux/macOS
-- with a SQL login.
--
-- WARNING: SQL Server cumulative updates may recreate these SPs, requiring
--          you to re-run this script.
--
-- Run this on the SQL Server instance that hosts SSISDB.
-- ============================================================================

USE [SSISDB];
GO

-- This cursor finds SQL modules in [catalog] and [internal] schemas whose
-- definition contains the SQL-Auth rejection (27123), extracts definition,
-- removes the IF…RAISERROR/THROW block, and ALTERs the module in place.

DECLARE @object_id   INT;
DECLARE @schema_name NVARCHAR(128);
DECLARE @sp_name     NVARCHAR(128);
DECLARE @object_type NVARCHAR(2);
DECLARE @definition  NVARCHAR(MAX);
DECLARE @new_def     NVARCHAR(MAX);
DECLARE @patched     INT = 0;

DECLARE sp_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT m.object_id,
           s.name AS schema_name,
           o.name AS sp_name,
        o.type AS object_type,
           m.definition
    FROM   sys.sql_modules m
    JOIN   sys.objects o ON m.object_id = o.object_id
    JOIN   sys.schemas s ON o.schema_id = s.schema_id
    WHERE  s.name IN (N'catalog', N'internal')
      AND  o.type IN ('P', 'FN', 'IF', 'TF')
      AND  m.definition LIKE N'%27123%';

OPEN sp_cursor;
FETCH NEXT FROM sp_cursor INTO @object_id, @schema_name, @sp_name, @object_type, @definition;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- The typical pattern in the SPs is one of these forms:
    --
    --   Form A (single-line RAISERROR):
    --     IF (SELECT [type] FROM [sys].[server_principals] WHERE [name] = ...)  IN (N'S')
    --         RAISERROR(27123, 16, 1) WITH NOWAIT
    --
    --   Form B (BEGIN…END block):
    --     IF (SELECT [type] FROM [sys].[server_principals] WHERE [name] = ...)  IN (N'S')
    --     BEGIN
    --         RAISERROR(27123, 16, 1) WITH NOWAIT
    --         RETURN 1
    --     END
    --
    -- Strategy: locate the IF line that leads to 27123 and blank out the
    -- entire block.  We search for the IF…27123 region by character position.

    SET @new_def = @definition;

    -- Find the position of the IF statement that precedes the 27123 RAISERROR.
    -- We look for the pattern: IF...server_principals...27123
    -- and remove from the IF up through the RAISERROR (or the END if it's a block).
    DECLARE @raiserror_pos INT = CHARINDEX('27123', @new_def);

    WHILE @raiserror_pos > 0
    BEGIN
        -- Walk backwards from the 27123 to find the preceding IF
        DECLARE @search_start INT = @raiserror_pos;
        DECLARE @if_pos INT = 0;

        -- Search backwards for 'IF' (case-insensitive via collation)
        WHILE @search_start > 1
        BEGIN
            SET @search_start = @search_start - 1;
            IF SUBSTRING(@new_def, @search_start, 2) = 'IF'
               AND (@search_start = 1
                    OR SUBSTRING(@new_def, @search_start - 1, 1) IN (CHAR(10), CHAR(13), CHAR(9), ' '))
            BEGIN
                -- Verify this IF is related to server_principals / 27123
                DECLARE @between_text NVARCHAR(MAX) = SUBSTRING(@new_def, @search_start, @raiserror_pos - @search_start);
                IF @between_text LIKE '%server_principals%' OR @between_text LIKE '%type%'
                BEGIN
                    SET @if_pos = @search_start;
                    BREAK;
                END
            END
        END

        IF @if_pos > 0
        BEGIN
            -- Find the end of the block: look for END after the RAISERROR, or just
            -- the end of the RAISERROR line if no BEGIN/END wrapper.
            DECLARE @block_end INT;
            DECLARE @has_begin INT = 0;

            -- Check if there's a BEGIN between IF and RAISERROR
            DECLARE @if_to_raiserror NVARCHAR(MAX) = SUBSTRING(@new_def, @if_pos, @raiserror_pos - @if_pos);
            IF @if_to_raiserror LIKE '%BEGIN%'
                SET @has_begin = 1;

            IF @has_begin = 1
            BEGIN
                -- Find the matching END after the RAISERROR
                SET @block_end = CHARINDEX('END', @new_def, @raiserror_pos);
                IF @block_end > 0
                    SET @block_end = @block_end + 3; -- past 'END'
                ELSE
                    SET @block_end = @raiserror_pos + 30; -- fallback
            END
            ELSE
            BEGIN
                -- No BEGIN/END — just blank out through the end of the RAISERROR line
                SET @block_end = CHARINDEX(CHAR(10), @new_def, @raiserror_pos);
                IF @block_end = 0
                    SET @block_end = LEN(@new_def);
            END

            -- Replace the IF…block with a comment
            SET @new_def = STUFF(@new_def, @if_pos, @block_end - @if_pos,
                '/* SQL Auth check removed by patch-ssisdb-sql-auth.sql */');
        END

        -- Look for another occurrence
        SET @raiserror_pos = CHARINDEX('27123', @new_def, @raiserror_pos + 1);
        -- Safety: if the 27123 is in our comment, skip it
        IF @raiserror_pos > 0
           AND SUBSTRING(@new_def, @raiserror_pos - 20, 50) LIKE '%patch-ssisdb%'
            SET @raiserror_pos = CHARINDEX('27123', @new_def, @raiserror_pos + 5);
    END

    -- Change CREATE to ALTER
    IF @new_def <> @definition
    BEGIN
        SET @new_def = STUFF(@new_def, CHARINDEX('CREATE', @new_def), 6, 'ALTER');
        BEGIN TRY
            EXEC sp_executesql @new_def;
            PRINT 'Patched: [' + @schema_name + '].[' + @sp_name + '] (type=' + @object_type + ')';
            SET @patched = @patched + 1;
        END TRY
        BEGIN CATCH
            PRINT 'FAILED to patch [' + @schema_name + '].[' + @sp_name + '] (type=' + @object_type + '): ' + ERROR_MESSAGE();
        END CATCH
    END

    FETCH NEXT FROM sp_cursor INTO @object_id, @schema_name, @sp_name, @object_type, @definition;
END

CLOSE sp_cursor;
DEALLOCATE sp_cursor;

PRINT '';
PRINT 'Done. Patched ' + CAST(@patched AS VARCHAR(10)) + ' module(s).';

PRINT '';
PRINT 'Remaining modules that still reference SQL-auth rejection (27123):';
SELECT s.name AS schema_name,
             o.name AS object_name,
             o.type AS object_type
FROM   sys.sql_modules m
JOIN   sys.objects o ON m.object_id = o.object_id
JOIN   sys.schemas s ON o.schema_id = s.schema_id
WHERE  s.name IN (N'catalog', N'internal')
    AND  o.type IN ('P', 'FN', 'IF', 'TF')
    AND  m.definition LIKE N'%27123%'
ORDER BY s.name, o.name;
GO
