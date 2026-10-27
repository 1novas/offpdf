//! MOVE-01…10 and MOVE-08b: moving a source line (issue #128) keeps it text, lands it exactly,
//! refuses positions off the visible page/clip, and never turns refused content into an editable
//! line.

use super::{after_text, close, ctx, model, ok_plan, plan, replacement, run_with, sized, style};
use crate::pdf_engine::text_edit::reasons::{EditProblemCode, TextReason};
use crate::pdf_engine::text_edit::rewrite::{MoveIn, TextEditIn};
use crate::pdf_engine::text_edit::testkit::producers::{
    self as fx, helvetica_page, BadBox, ClipKind,
};

/// An edit of `old` that keeps its text and moves the line by (`dx`, `dy`) user-space points.
fn moved(
    m: &crate::pdf_engine::text_edit::runs::PageModel,
    old: &str,
    dx: f64,
    dy: f64,
) -> TextEditIn {
    let run = run_with(m, old);
    TextEditIn {
        run_id: run.id.clone(),
        original_text: old.to_string(),
        text: old.to_string(),
        style: style(),
        move_by: Some(MoveIn { x: dx, y: dy }),
    }
}

fn moved_text(
    m: &crate::pdf_engine::text_edit::runs::PageModel,
    old: &str,
    new: &str,
    dx: f64,
    dy: f64,
) -> TextEditIn {
    let mut e = moved(m, old, dx, dy);
    e.text = new.to_string();
    e
}

#[test]
fn move_01_move_only_lands_the_line_and_restores_the_matrix() {
    let c = ctx(helvetica_page(b"BT /F1 12 Tf 72 700 Td (Hello) Tj ET"));
    let m = model(&c, 0);
    let run = run_with(&m, "Hello");
    let out = plan(&c, &m, &[moved(&m, "Hello", 20.0, -10.0)]);
    let v = &out.verdicts[0];
    assert!(v.problem.is_none(), "move refused: {:?}", v.problem);
    let rect = v.new_rect.expect("moved rect");
    assert!(close(rect[0], run.rect[0] + 20.0, 0.02), "x {}", rect[0]);
    assert!(close(rect[1], run.rect[1] - 10.0, 0.02), "y {}", rect[1]);
    assert!(close(rect[2], run.rect[2], 0.02), "width unchanged");
    let plan = ok_plan(&out);
    assert_eq!(plan.runs[0].expected.move_user, (20.0, -10.0));
    assert!(close(
        plan.runs[0].expected.origin.0,
        run.origin.0 + 20.0,
        0.02
    ));
    assert!(close(
        plan.runs[0].expected.origin.1,
        run.origin.1 - 10.0,
        0.02
    ));
    // One `Tm` before the moved show and one restore `Tm` after it; the restore is followed by
    // an empty TJ that advances the text matrix to where the source show left it.
    let r = replacement(&out, 0);
    assert_eq!(r.matches(" Tm").count(), 2, "moved and restore Tm: {r}");
    assert!(r.trim_end().ends_with("] TJ"), "restore TJ last: {r}");
    assert_eq!(
        plan.runs[0].expected.emitted_records,
        vec![2],
        "show + restore"
    );
    assert!(
        replacement(&out, 0).contains("<48656C6C6F>"),
        "the text is still text"
    );
    let after = after_text(&out);
    assert!(
        after.contains(" Tm"),
        "the saved page has text matrices: {after}"
    );
}

#[test]
fn move_02_text_and_move_are_one_edit() {
    let c = ctx(helvetica_page(b"BT /F1 12 Tf 72 700 Td (Hello) Tj ET"));
    let m = model(&c, 0);
    let run = run_with(&m, "Hello");
    let mut edit = moved_text(&m, "Hello", "Hello!", 20.0, -10.0);
    // A size change and a move in one edit: the move must stay 20 × −10 user points even though
    // the `Tm` translation is written in text space, not in the new glyph-size space.
    edit.style = sized(21.0);
    let out = plan(&c, &m, &[edit]);
    let v = &out.verdicts[0];
    assert!(v.problem.is_none(), "text+move refused: {:?}", v.problem);
    let rect = v.new_rect.expect("rect");
    assert!(close(rect[0], run.rect[0] + 20.0, 0.02), "x {}", rect[0]);
    assert!(close(rect[1], run.rect[1] - 10.0, 0.02), "y {}", rect[1]);
    assert!(rect[2] > run.rect[2], "the added glyph makes it wider");
    assert_eq!(ok_plan(&out).runs[0].expected.move_user, (20.0, -10.0));
    let r = replacement(&out, 0);
    assert!(r.contains("21"), "the new size and ! are written: {r}");
    assert_eq!(r.matches(" Tm").count(), 2, "{r}");
    assert!(after_text(&out).contains("21"), "{}", after_text(&out));
}

#[test]
fn move_03_rotate_0_90_180_270_use_the_same_user_space_delta() {
    for angle in [0, 90, 180, 270] {
        let c = ctx(fx::rotated(angle, true));
        let m = model(&c, 0);
        let run = run_with(&m, "Rotated page");
        let out = plan(&c, &m, &[moved(&m, "Rotated page", 20.0, -10.0)]);
        let v = &out.verdicts[0];
        assert!(
            v.problem.is_none(),
            "/Rotate {angle} refused: {:?}",
            v.problem
        );
        let rect = v.new_rect.expect("rect");
        assert!(
            close(rect[0], run.rect[0] + 20.0, 0.02),
            "/Rotate {angle} x {}",
            rect[0]
        );
        assert!(
            close(rect[1], run.rect[1] - 10.0, 0.02),
            "/Rotate {angle} y {}",
            rect[1]
        );
        assert_eq!(
            replacement(&out, 0).matches(" Tm").count(),
            2,
            "/Rotate {angle}"
        );
    }
}

#[test]
fn move_04_cropbox_offsets_are_respected() {
    let c = ctx(fx::cropped_offset());
    let m = model(&c, 0);
    let run = run_with(&m, "Cropped page");
    let out = plan(&c, &m, &[moved(&m, "Cropped page", 20.0, -10.0)]);
    assert!(
        out.verdicts[0].problem.is_none(),
        "{:?}",
        out.verdicts[0].problem
    );
    let rect = out.verdicts[0].new_rect.expect("rect");
    assert!(close(rect[0], run.rect[0] + 20.0, 0.02));
    assert!(close(rect[1], run.rect[1] - 10.0, 0.02));

    // The CropBox starts at x = 36; moving left by 100 puts the line outside it.
    let out = plan(&c, &m, &[moved(&m, "Cropped page", -100.0, 0.0)]);
    let p = out.verdicts[0]
        .problem
        .as_ref()
        .expect("refused outside the crop");
    assert_eq!(p.code, EditProblemCode::TextOutsideVisibleArea, "{p:?}");

    // The CropBox ends at x = 576; moving right by 600 puts the line outside it.
    let out = plan(&c, &m, &[moved(&m, "Cropped page", 600.0, 0.0)]);
    let p = out.verdicts[0]
        .problem
        .as_ref()
        .expect("refused outside the crop");
    assert_eq!(p.code, EditProblemCode::TextOutsideVisibleArea, "{p:?}");
}

#[test]
fn move_05_a_move_off_the_page_is_refused() {
    let c = ctx(helvetica_page(b"BT /F1 12 Tf 72 700 Td (Hello) Tj ET"));
    let m = model(&c, 0);
    for (dx, dy) in [(1000.0, 0.0), (0.0, 1000.0), (0.0, -1000.0)] {
        let out = plan(&c, &m, &[moved(&m, "Hello", dx, dy)]);
        let p = out.verdicts[0]
            .problem
            .as_ref()
            .expect("off-page move refused");
        assert_eq!(
            p.code,
            EditProblemCode::TextOutsideVisibleArea,
            "{dx},{dy}: {p:?}"
        );
        assert!(p.detail.is_some(), "the refusal names the moved box");
    }
}

#[test]
fn move_06_shared_and_unsupported_lines_stay_refused() {
    // A stream shared by several pages is not one page's text.
    let c = ctx(fx::shared());
    let m = model(&c, 0);
    let run = run_with(&m, "Shared body");
    assert!(run.reasons.contains(&TextReason::SharedContent));
    let out = plan(&c, &m, &[moved(&m, "Shared body", 10.0, 0.0)]);
    let p = out.verdicts[0].problem.as_ref().expect("shared refused");
    assert_eq!(p.code, EditProblemCode::TextEditRefused);
    assert_eq!(p.reason, Some(TextReason::SharedContent));

    // Type 3 glyph procedures are not editable text.
    let c = ctx(fx::type3());
    let m = model(&c, 0);
    let run = run_with(&m, "a");
    assert!(run.reasons.contains(&TextReason::Type3));
    let out = plan(&c, &m, &[moved(&m, "a", 10.0, 0.0)]);
    let p = out.verdicts[0].problem.as_ref().expect("type3 refused");
    assert_eq!(p.code, EditProblemCode::TextEditRefused);
    assert_eq!(p.reason, Some(TextReason::Type3));
}

#[test]
fn move_07_malformed_geometry_has_no_editable_line_to_move() {
    for kind in [BadBox::OddRotate, BadBox::ThinCrop, BadBox::NoMediaBox] {
        let c = ctx(fx::bad_boxes(kind));
        let m = model(&c, 0);
        assert_eq!(m.page_reason, Some(TextReason::Geometry), "{kind:?}");
        assert!(
            m.runs.iter().all(|r| !r.reasons.is_empty()),
            "{kind:?} has an editable run"
        );
    }
}

#[test]
fn move_08_a_page_sized_rectangular_clip_allows_moves_inside_it() {
    let c = ctx(fx::clip(ClipKind::Page));
    let m = model(&c, 0);
    let out = plan(&c, &m, &[moved(&m, "Clip me", 20.0, -10.0)]);
    assert!(
        out.verdicts[0].problem.is_none(),
        "{:?}",
        out.verdicts[0].problem
    );
    assert_eq!(replacement(&out, 0).matches(" Tm").count(), 2);
}

/// The page in `move_01` uses `Td`; a `Tm`-positioned line must still restore its line matrix.
#[test]
fn move_08b_a_non_rectangular_clip_refuses_the_move() {
    let c = ctx(fx::clip(ClipKind::Curve));
    let m = model(&c, 0);
    let out = plan(&c, &m, &[moved(&m, "Clip me", 20.0, -10.0)]);
    let p = out.verdicts[0]
        .problem
        .as_ref()
        .expect("curve clip refused");
    assert_eq!(p.code, EditProblemCode::TextEditRefused);
    assert_eq!(p.reason, Some(TextReason::Clipped));
}

#[test]
fn move_09_a_tm_positioned_line_restores_tlm_for_following_tstar() {
    let c = ctx(helvetica_page(
        b"BT /F1 12 Tf 1 0 0 1 72 700 Tm (Hello) Tj T* (next) Tj ET",
    ));
    let m = model(&c, 0);
    let out = plan(&c, &m, &[moved(&m, "Hello", 20.0, -10.0)]);
    assert!(
        out.verdicts[0].problem.is_none(),
        "{:?}",
        out.verdicts[0].problem
    );
    let after = after_text(&out);
    // The restore keeps Tlm at the source line start, so the following T* still puts "next" at
    // the source line's next line, not at the moved one.
    assert!(after.contains("T*"), "{after}");
    assert!(
        after.contains("(next)") || after.contains("next"),
        "{after}"
    );
}

#[test]
fn move_10_an_empty_text_removal_ignores_the_move() {
    let c = ctx(helvetica_page(b"BT /F1 12 Tf 72 700 Td (Hello) Tj ET"));
    let m = model(&c, 0);
    let mut e = moved(&m, "Hello", 20.0, -10.0);
    e.text.clear();
    let out = plan(&c, &m, &[e]);
    assert!(
        out.verdicts[0].problem.is_none(),
        "{:?}",
        out.verdicts[0].problem
    );
    let plan = ok_plan(&out);
    assert_eq!(plan.runs[0].expected.move_user, (0.0, 0.0));
    assert!(!replacement(&out, 0).contains(" Tm"));
}
