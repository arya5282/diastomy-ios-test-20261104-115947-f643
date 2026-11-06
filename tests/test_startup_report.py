"""Regression tests: a launch-stage report must not count as a ready UI."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('startup_check', Path(__file__).resolve().parents[1] / 'scripts/test_ios_startup.py')
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


class StartupReportTests(unittest.TestCase):
    def test_intermediate_stage_is_not_success(self):
        report = Mock()
        report.exists.return_value = True
        ready = {'stage': 'ready', 'complete': True, 'ready': True, 'localDocument': True}
        report.read_text.side_effect = [json.dumps({'stage': 'applicationLaunched', 'complete': False}), json.dumps(ready)]
        with patch.object(startup.time, 'sleep'):
            self.assertEqual(startup.wait_for_report(report), ready)
        self.assertEqual(report.read_text.call_count, 2)

    def test_terminal_failure_is_reported(self):
        report = Mock()
        report.exists.return_value = True
        failure = {'stage': 'failed', 'complete': True, 'ready': False, 'message': 'bridge error'}
        report.read_text.return_value = json.dumps(failure)
        self.assertEqual(startup.wait_for_report(report), failure)

    def test_absent_report_is_not_ignored(self):
        report = Mock()
        report.exists.return_value = False
        with patch.object(startup.time, 'monotonic', side_effect=[0, 0, 61]), patch.object(startup.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'Last native report: None'):
                startup.wait_for_report(report)


if __name__ == '__main__':
    unittest.main()
